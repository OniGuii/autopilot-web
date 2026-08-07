import { Injectable, Logger, Optional } from '@nestjs/common';
import { MessageDirection, WhatsAppConnectionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../shared/redis/redis.service';
import {
  AI_AGENT_MESSAGE_SOURCE,
  AI_AUTO_ANTI_LOOP_CONSECUTIVE,
  AI_AUTO_LEAD_COOLDOWN_SECONDS,
  AI_AUTO_MAX_PER_COMPANY_PER_MINUTE,
  AI_AUTO_MAX_PER_CONVERSATION,
  AI_AUTO_MIN_CONFIDENCE,
  AI_AUTO_RATE_KEY_PREFIX,
} from './ai.constants';

export type AutoGuardrailInput = {
  companyId: string;
  conversationId: string;
  leadId: string;
  confidence: number;
  maxAutoRepliesPerLeadDay: number;
  agentPaused: boolean;
};

export type AutoGuardrailResult =
  { allowed: true } | { allowed: false; reason: string };

@Injectable()
export class AiAutoGuardrailsService {
  private readonly logger = new Logger(AiAutoGuardrailsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly redis?: RedisService,
  ) {}

  async evaluate(input: AutoGuardrailInput): Promise<AutoGuardrailResult> {
    if (input.agentPaused) {
      return { allowed: false, reason: 'AGENT_PAUSED' };
    }

    if (input.confidence < AI_AUTO_MIN_CONFIDENCE) {
      return { allowed: false, reason: 'LOW_CONFIDENCE' };
    }

    const instance = await this.prisma.whatsAppInstance.findFirst({
      where: { companyId: input.companyId, deletedAt: null },
      select: { status: true },
    });
    if (!instance || instance.status !== WhatsAppConnectionStatus.CONNECTED) {
      return { allowed: false, reason: 'WHATSAPP_NOT_CONNECTED' };
    }

    const conversationAutoCount = await this.prisma.message.count({
      where: {
        companyId: input.companyId,
        conversationId: input.conversationId,
        deletedAt: null,
        direction: MessageDirection.OUTBOUND,
        metadata: {
          path: ['source'],
          equals: AI_AGENT_MESSAGE_SOURCE,
        },
      },
    });
    if (conversationAutoCount >= AI_AUTO_MAX_PER_CONVERSATION) {
      return { allowed: false, reason: 'CONVERSATION_AUTO_LIMIT' };
    }

    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const leadDayCount = await this.prisma.message.count({
      where: {
        companyId: input.companyId,
        deletedAt: null,
        direction: MessageDirection.OUTBOUND,
        createdAt: { gte: dayStart },
        conversation: { leadId: input.leadId, deletedAt: null },
        metadata: {
          path: ['source'],
          equals: AI_AGENT_MESSAGE_SOURCE,
        },
      },
    });
    if (leadDayCount >= input.maxAutoRepliesPerLeadDay) {
      return { allowed: false, reason: 'LEAD_DAILY_AUTO_LIMIT' };
    }

    const cooldownSince = new Date(
      Date.now() - AI_AUTO_LEAD_COOLDOWN_SECONDS * 1000,
    );
    const recentLeadAuto = await this.prisma.message.findFirst({
      where: {
        companyId: input.companyId,
        deletedAt: null,
        direction: MessageDirection.OUTBOUND,
        createdAt: { gte: cooldownSince },
        conversation: { leadId: input.leadId, deletedAt: null },
        metadata: {
          path: ['source'],
          equals: AI_AGENT_MESSAGE_SOURCE,
        },
      },
      select: { id: true },
    });
    if (recentLeadAuto) {
      return { allowed: false, reason: 'LEAD_COOLDOWN' };
    }

    const antiLoop = await this.detectAntiLoop(
      input.companyId,
      input.conversationId,
    );
    if (!antiLoop.allowed) return antiLoop;

    if (this.redis) {
      const key = `${AI_AUTO_RATE_KEY_PREFIX}${input.companyId}`;
      const n = await this.redis.incrWithExpire(key, 60);
      if (n === null) {
        // Redis down → fail closed for AUTO (degrade ASSIST).
        this.logger.warn(
          `AUTO rate-limit redis unavailable company=${input.companyId}`,
        );
        return { allowed: false, reason: 'RATE_LIMIT_UNAVAILABLE' };
      }
      if (n > AI_AUTO_MAX_PER_COMPANY_PER_MINUTE) {
        return { allowed: false, reason: 'COMPANY_RATE_LIMIT' };
      }
    }

    return { allowed: true };
  }

  private async detectAntiLoop(
    companyId: string,
    conversationId: string,
  ): Promise<AutoGuardrailResult> {
    const recent = await this.prisma.message.findMany({
      where: {
        companyId,
        conversationId,
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      take: AI_AUTO_ANTI_LOOP_CONSECUTIVE + 2,
      select: {
        direction: true,
        metadata: true,
      },
    });

    let consecutiveAi = 0;
    for (const msg of recent) {
      if (msg.direction !== MessageDirection.OUTBOUND) break;
      const source =
        msg.metadata &&
        typeof msg.metadata === 'object' &&
        !Array.isArray(msg.metadata)
          ? (msg.metadata as { source?: unknown }).source
          : null;
      if (source === AI_AGENT_MESSAGE_SOURCE) {
        consecutiveAi += 1;
      } else {
        break;
      }
    }

    if (consecutiveAi >= AI_AUTO_ANTI_LOOP_CONSECUTIVE) {
      return { allowed: false, reason: 'ANTI_LOOP' };
    }
    return { allowed: true };
  }
}
