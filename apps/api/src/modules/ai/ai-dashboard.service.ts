import { Injectable } from '@nestjs/common';
import { AiAgentMode, MessageDirection } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AI_AGENT_MESSAGE_SOURCE, AI_ESCALATED } from './ai.constants';

type Actor = { cid: string; sub: string };

@Injectable()
export class AiDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(actor: Actor) {
    const companyId = actor.cid;
    const settings = await this.prisma.companyAiSettings.findFirst({
      where: { companyId, deletedAt: null },
      select: { mode: true, maxAutoRepliesPerLeadDay: true },
    });

    const mode = settings?.mode ?? AiAgentMode.ASSIST;

    const [autoReplied, escalated, kbEntries, pausedConversations] =
      await Promise.all([
        this.prisma.message.count({
          where: {
            companyId,
            deletedAt: null,
            direction: MessageDirection.OUTBOUND,
            metadata: {
              path: ['source'],
              equals: AI_AGENT_MESSAGE_SOURCE,
            },
          },
        }),
        this.prisma.auditLog.count({
          where: { companyId, action: AI_ESCALATED },
        }),
        this.prisma.knowledgeBaseEntry.count({
          where: { companyId, deletedAt: null, active: true },
        }),
        this.prisma.conversation.count({
          where: { companyId, deletedAt: null, agentPaused: true },
        }),
      ]);

    const treated = autoReplied + escalated;
    const automationRate =
      treated === 0 ? null : Number((autoReplied / treated).toFixed(4));

    return {
      companyId,
      generatedAt: new Date().toISOString(),
      mode,
      autoEnabled: mode === AiAgentMode.AUTO,
      maxAutoRepliesPerLeadDay: settings?.maxAutoRepliesPerLeadDay ?? 3,
      metrics: {
        autoReplied,
        escalatedToHuman: escalated,
        automationRate,
        kbEntriesActive: kbEntries,
        pausedConversations,
      },
    };
  }
}
