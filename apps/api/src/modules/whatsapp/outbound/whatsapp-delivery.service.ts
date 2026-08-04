import { Injectable, Optional } from '@nestjs/common';
import { MessageDirection, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { PrometheusMetricsService } from '../../../observability/prometheus-metrics.service';
import { AuditService } from '../../audit/audit.service';
import {
  auditActionForStatus,
  canTransitionOutboundStatus,
  isRegressionOrInvalidTransition,
  OUTBOUND_MESSAGE_STATUS,
} from './message-status';
import type { ParsedDeliveryUpdate } from './parse-delivery-update';
import type { EchoCandidate } from './parse-echo-candidate';

const HEAL_WINDOW_MS = 2 * 60 * 1000;

export type DeliveryApplyResult =
  | { kind: 'applied'; messageId: string; from: string; to: string }
  | { kind: 'noop'; messageId: string; status: string }
  | { kind: 'regression'; messageId: string; from: string; to: string }
  | { kind: 'not_found' };

export type EchoHealResult =
  | {
      kind: 'healed';
      messageId: string;
      conversationId: string;
      leadId: string;
    }
  | {
      kind: 'duplicate';
      messageId: string;
      conversationId: string;
      leadId: string;
    }
  | { kind: 'ignored' };

@Injectable()
export class WhatsappDeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly prom?: PrometheusMetricsService,
  ) {}

  async applyDeliveryUpdate(
    companyId: string,
    update: ParsedDeliveryUpdate,
  ): Promise<DeliveryApplyResult> {
    const message = await this.prisma.message.findFirst({
      where: {
        companyId,
        externalMessageId: update.externalMessageId,
        direction: MessageDirection.OUTBOUND,
        deletedAt: null,
      },
    });

    if (!message) {
      return { kind: 'not_found' };
    }

    if (message.status === update.targetStatus) {
      return { kind: 'noop', messageId: message.id, status: message.status };
    }

    if (
      isRegressionOrInvalidTransition(message.status, update.targetStatus) ||
      !canTransitionOutboundStatus(message.status, update.targetStatus)
    ) {
      await this.prisma.$transaction(async (tx) => {
        await this.audit.write(tx, {
          companyId,
          actorUserId: null,
          action: 'WHATSAPP_MESSAGE_STATUS_REGRESSION',
          targetType: 'MESSAGE',
          targetId: message.id,
          before: { status: message.status },
          after: {
            attemptedStatus: update.targetStatus,
            ignored: true,
          },
        });
      });

      return {
        kind: 'regression',
        messageId: message.id,
        from: message.status,
        to: update.targetStatus,
      };
    }

    const data: Prisma.MessageUpdateManyMutationInput = {
      status: update.targetStatus,
    };

    if (update.targetStatus === OUTBOUND_MESSAGE_STATUS.SENT) {
      data.sentAt = message.sentAt ?? update.occurredAt;
    }
    if (update.targetStatus === OUTBOUND_MESSAGE_STATUS.DELIVERED) {
      data.deliveredAt = update.occurredAt;
      const sentAt = message.sentAt ?? message.createdAt;
      if (sentAt) {
        const latencyMs =
          update.occurredAt.getTime() - new Date(sentAt).getTime();
        this.prom?.recordWhatsappDeliveryLatency(latencyMs);
      }
    }
    if (update.targetStatus === OUTBOUND_MESSAGE_STATUS.READ) {
      data.readAt = update.occurredAt;
    }
    if (update.targetStatus === OUTBOUND_MESSAGE_STATUS.FAILED) {
      data.failedAt = update.occurredAt;
      data.errorMessage = update.errorMessage;
    }

    const auditAction = auditActionForStatus(update.targetStatus);

    const applied = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.message.updateMany({
        where: {
          id: message.id,
          companyId,
          status: message.status,
          deletedAt: null,
        },
        data,
      });

      if (updated.count === 0) {
        return false;
      }

      if (auditAction) {
        // P3-A1: send API already audits SENT from PENDING; webhook SENT only if from PENDING
        if (
          auditAction === 'WHATSAPP_MESSAGE_SENT' &&
          message.status !== OUTBOUND_MESSAGE_STATUS.PENDING
        ) {
          return true;
        }

        await this.audit.write(tx, {
          companyId,
          actorUserId: null,
          action: auditAction,
          targetType: 'MESSAGE',
          targetId: message.id,
          before: { status: message.status },
          after: {
            status: update.targetStatus,
            externalMessageId: message.externalMessageId,
          },
        });
      }

      return true;
    });

    if (!applied) {
      return { kind: 'noop', messageId: message.id, status: message.status };
    }

    return {
      kind: 'applied',
      messageId: message.id,
      from: message.status,
      to: update.targetStatus,
    };
  }

  /**
   * P3-E1/E2 + 6B CH3 — Echo Protection heal race:
   * fromMe upsert with unknown external id → attach to recent OUTBOUND
   * PENDING/SENT, or FAILED with null external id (UNCERTAIN_TIMEOUT).
   */
  async healEchoRace(
    companyId: string,
    echo: EchoCandidate,
  ): Promise<EchoHealResult> {
    const existing = await this.prisma.message.findFirst({
      where: {
        companyId,
        externalMessageId: echo.externalMessageId,
        deletedAt: null,
      },
      select: {
        id: true,
        conversationId: true,
        conversation: { select: { leadId: true } },
      },
    });

    if (existing) {
      return {
        kind: 'duplicate',
        messageId: existing.id,
        conversationId: existing.conversationId,
        leadId: existing.conversation.leadId,
      };
    }

    const since = new Date(Date.now() - HEAL_WINDOW_MS);
    const candidate = await this.prisma.message.findFirst({
      where: {
        companyId,
        direction: MessageDirection.OUTBOUND,
        deletedAt: null,
        externalMessageId: null,
        status: {
          in: [
            OUTBOUND_MESSAGE_STATUS.PENDING,
            OUTBOUND_MESSAGE_STATUS.SENT,
            OUTBOUND_MESSAGE_STATUS.FAILED,
          ],
        },
        createdAt: { gte: since },
        conversation: {
          deletedAt: null,
          lead: { phone: echo.remotePhone, deletedAt: null },
        },
        ...(echo.body ? { body: echo.body } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: { conversation: { select: { leadId: true } } },
    });

    if (!candidate) {
      return { kind: 'ignored' };
    }

    const fromFailed = candidate.status === OUTBOUND_MESSAGE_STATUS.FAILED;
    const correlationId = readCorrelationId(candidate.metadata);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.message.update({
        where: { id: candidate.id },
        data: {
          externalMessageId: echo.externalMessageId,
          status: OUTBOUND_MESSAGE_STATUS.SENT,
          sentAt: candidate.sentAt ?? now,
          errorMessage: null,
          failedAt: null,
        },
      });

      if (fromFailed) {
        await this.audit.write(tx, {
          companyId,
          actorUserId: null,
          action: 'WHATSAPP_MESSAGE_UNCERTAIN_RESOLVED',
          targetType: 'MESSAGE',
          targetId: candidate.id,
          before: {
            status: OUTBOUND_MESSAGE_STATUS.FAILED,
            correlationId,
          },
          after: {
            status: OUTBOUND_MESSAGE_STATUS.SENT,
            externalMessageId: echo.externalMessageId,
            healedFromEcho: true,
            correlationId,
          },
        });
      } else if (candidate.status === OUTBOUND_MESSAGE_STATUS.PENDING) {
        await this.audit.write(tx, {
          companyId,
          actorUserId: null,
          action: 'WHATSAPP_MESSAGE_SENT',
          targetType: 'MESSAGE',
          targetId: candidate.id,
          before: {
            status: OUTBOUND_MESSAGE_STATUS.PENDING,
            correlationId,
          },
          after: {
            status: OUTBOUND_MESSAGE_STATUS.SENT,
            externalMessageId: echo.externalMessageId,
            healedFromEcho: true,
            correlationId,
          },
        });
      }
    });

    return {
      kind: 'healed',
      messageId: candidate.id,
      conversationId: candidate.conversationId,
      leadId: candidate.conversation.leadId,
    };
  }
}

function readCorrelationId(metadata: unknown): string | null {
  if (
    metadata &&
    typeof metadata === 'object' &&
    !Array.isArray(metadata) &&
    'correlationId' in metadata &&
    typeof (metadata as { correlationId?: unknown }).correlationId === 'string'
  ) {
    return (metadata as { correlationId: string }).correlationId;
  }
  return null;
}
