import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConversationStatus,
  MessageDirection,
  Prisma,
  WhatsAppConnectionStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { PrometheusMetricsService } from '../../../observability/prometheus-metrics.service';
import { OutboundSendProducer } from '../../async/producers/outbound-send.producer';
import { AuditService } from '../../audit/audit.service';
import type { AuthenticatedUser } from '../../auth/types/jwt-payload';
import { newCorrelationId } from '../correlation';
import { EVOLUTION_ERROR_CLASS } from '../evolution.constants';
import { EvolutionClient } from '../evolution.client';
import { isEvolutionChannelError } from '../evolution.errors';
import { OUTBOUND_MESSAGE_STATUS } from './message-status';

type CompanyActor = AuthenticatedUser & { cid: string; sub: string };

type RequestMeta = {
  ip?: string;
  userAgent?: string;
};

const AUDIT_BODY_MAX = 2000;

export type SendWhatsappMetadata = {
  source: string;
  followUpId?: string;
  attempt?: number;
  correlationId?: string;
  [key: string]: unknown;
};

export type SendWhatsappInput = {
  leadId: string;
  conversationId: string;
  body: string;
  /** Merged into Message.metadata (P4-S1 / P4-D5). Defaults source=whatsapp_send */
  metadata?: SendWhatsappMetadata;
};

export type SendWhatsappResult = {
  ok: true;
  messageId: string;
  conversationId: string;
  leadId: string;
  externalMessageId: string;
  status: string;
  correlationId: string;
};

export type SendWhatsappAcceptedResult = {
  ok: true;
  accepted: true;
  messageId: string;
  conversationId: string;
  leadId: string;
  status: string;
  correlationId: string;
  jobId: string;
};

@Injectable()
export class WhatsappSendService {
  private readonly logger = new Logger(WhatsappSendService.name);
  private readonly asyncOutboundEnabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly evolution: EvolutionClient,
    private readonly config: ConfigService,
    @Optional() private readonly outboundProducer?: OutboundSendProducer,
    @Optional() private readonly prom?: PrometheusMetricsService,
  ) {
    this.asyncOutboundEnabled =
      this.config.get<boolean>('async.outboundEnabled', false) === true;
  }

  /** P4-F1 helper — check before FollowUp enters EXECUTING */
  async assertConnected(companyId: string): Promise<void> {
    const instance = await this.prisma.whatsAppInstance.findFirst({
      where: { companyId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!instance) {
      throw new ConflictException('WhatsApp instance not found');
    }
    if (instance.status !== WhatsAppConnectionStatus.CONNECTED) {
      throw new ConflictException('WhatsApp instance not CONNECTED');
    }
  }

  /** CH5/CH6 — circuit OPEN → 503 without PENDING/EXECUTING */
  assertChannelAvailable(): void {
    this.evolution.assertAvailable();
  }

  /**
   * HTTP entry (8C). Flag off → sync send (comportamento atual).
   * Flag on → PENDING + enqueue + accepted.
   * FollowUp continues to call `send()` (always sync).
   */
  async sendHttp(
    actor: CompanyActor,
    input: SendWhatsappInput,
    meta?: RequestMeta,
  ): Promise<SendWhatsappResult | SendWhatsappAcceptedResult> {
    if (this.asyncOutboundEnabled) {
      return this.acceptSend(actor, input, meta);
    }
    return this.send(actor, input, meta);
  }

  /**
   * Authenticated outbound send (sync).
   * Tenant = JWT.cid only. Never reads companyId from DTO/payload.
   * P4-D1: FollowUp must call this — never create Message directly.
   */
  async send(
    actor: CompanyActor,
    input: SendWhatsappInput,
    meta?: RequestMeta,
  ): Promise<SendWhatsappResult> {
    const prepared = await this.createPendingMessage(actor, input);
    return this.deliverPending(prepared, actor, meta);
  }

  /**
   * 8C worker entry — claim PENDING Message → Evolution → SENT|FAILED.
   * Always runs delivery (ignores ASYNC_OUTBOUND_ENABLED).
   */
  async processOutboundJob(input: {
    companyId: string;
    messageId: string;
    actorUserId: string;
    correlationId: string;
    meta?: RequestMeta;
  }): Promise<{
    ok: true;
    messageId: string;
    status: string;
    externalMessageId: string | null;
    correlationId: string;
  }> {
    const companyId = input.companyId;
    const message = await this.prisma.message.findFirst({
      where: {
        id: input.messageId,
        companyId,
        deletedAt: null,
        direction: MessageDirection.OUTBOUND,
      },
    });
    if (!message) {
      throw new NotFoundException('Message not found');
    }

    // Idempotent: already delivered
    if (
      message.status === OUTBOUND_MESSAGE_STATUS.SENT ||
      message.status === OUTBOUND_MESSAGE_STATUS.DELIVERED ||
      message.status === OUTBOUND_MESSAGE_STATUS.READ
    ) {
      return {
        ok: true,
        messageId: message.id,
        status: message.status,
        externalMessageId: message.externalMessageId,
        correlationId: input.correlationId,
      };
    }

    if (message.status === OUTBOUND_MESSAGE_STATUS.FAILED) {
      throw new ConflictException('Message already FAILED');
    }

    if (message.status !== OUTBOUND_MESSAGE_STATUS.PENDING) {
      throw new ConflictException(
        `Unexpected message status=${message.status}`,
      );
    }

    // Claim atômico (SELECT FOR UPDATE) — evita double Evolution send.
    const claim = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          status: string;
          external_message_id: string | null;
          metadata: unknown;
        }>
      >`
        SELECT id, status, external_message_id, metadata
        FROM messages
        WHERE id = ${message.id}::uuid
          AND company_id = ${companyId}::uuid
          AND deleted_at IS NULL
        FOR UPDATE
      `;
      const row = rows[0];
      if (!row) {
        return { kind: 'missing' as const };
      }
      if (
        row.status === OUTBOUND_MESSAGE_STATUS.SENT ||
        row.status === OUTBOUND_MESSAGE_STATUS.DELIVERED ||
        row.status === OUTBOUND_MESSAGE_STATUS.READ
      ) {
        return {
          kind: 'already_sent' as const,
          status: row.status,
          externalMessageId: row.external_message_id,
        };
      }
      if (row.status !== OUTBOUND_MESSAGE_STATUS.PENDING) {
        return { kind: 'bad_status' as const, status: row.status };
      }
      const meta = asJsonObject(row.metadata);
      if (typeof meta.outboundClaimedAt === 'string') {
        return { kind: 'claimed' as const };
      }
      await tx.message.update({
        where: { id: message.id },
        data: {
          metadata: {
            ...meta,
            outboundClaimedAt: new Date().toISOString(),
            outboundClaimCorrelationId: input.correlationId,
          },
        },
      });
      return { kind: 'ok' as const };
    });

    if (claim.kind === 'already_sent') {
      return {
        ok: true,
        messageId: message.id,
        status: claim.status,
        externalMessageId: claim.externalMessageId,
        correlationId: input.correlationId,
      };
    }
    if (claim.kind !== 'ok') {
      this.logger.warn(
        `outbound claim lost messageId=${message.id} kind=${claim.kind} correlationId=${input.correlationId}`,
      );
      throw new ConflictException('Message already claimed or not PENDING');
    }

    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: message.conversationId,
        companyId,
        deletedAt: null,
      },
    });
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const lead = await this.prisma.lead.findFirst({
      where: { id: conversation.leadId, companyId, deletedAt: null },
    });
    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    const metaObj = asJsonObject(message.metadata);
    const instanceName =
      typeof metaObj.evolutionInstanceName === 'string'
        ? metaObj.evolutionInstanceName
        : null;
    const instance = instanceName
      ? await this.prisma.whatsAppInstance.findFirst({
          where: {
            companyId,
            evolutionInstanceName: instanceName,
            deletedAt: null,
          },
        })
      : await this.prisma.whatsAppInstance.findFirst({
          where: { companyId, deletedAt: null },
        });
    if (!instance) {
      throw new ConflictException('WhatsApp instance not found');
    }

    const actor = { cid: companyId, sub: input.actorUserId } as CompanyActor;
    const body = (message.body ?? '').trim();
    const source =
      typeof metaObj.source === 'string' ? metaObj.source : 'whatsapp_send';

    return this.deliverPending(
      {
        companyId,
        actor,
        lead,
        conversation,
        instance,
        pending: message,
        body,
        correlationId: input.correlationId,
        source,
      },
      actor,
      input.meta,
    ).then((r) => ({
      ok: true as const,
      messageId: r.messageId,
      status: r.status,
      externalMessageId: r.externalMessageId,
      correlationId: r.correlationId,
    }));
  }

  private async acceptSend(
    actor: CompanyActor,
    input: SendWhatsappInput,
    meta?: RequestMeta,
  ): Promise<SendWhatsappAcceptedResult> {
    if (!this.outboundProducer) {
      throw new ServiceUnavailableException(
        'Async outbound enabled but producer is unavailable',
      );
    }

    const prepared = await this.createPendingMessage(actor, input);

    try {
      const { jobId, deduped } = await this.outboundProducer.enqueue({
        v: 1,
        companyId: prepared.companyId,
        messageId: prepared.pending.id,
        leadId: prepared.lead.id,
        conversationId: prepared.conversation.id,
        actorUserId: actor.sub,
        correlationId: prepared.correlationId,
        ...(meta?.ip ? { ip: meta.ip } : {}),
        ...(meta?.userAgent ? { userAgent: meta.userAgent } : {}),
      });

      if (deduped) {
        return {
          ok: true,
          accepted: true,
          messageId: prepared.pending.id,
          conversationId: prepared.conversation.id,
          leadId: prepared.lead.id,
          status: OUTBOUND_MESSAGE_STATUS.PENDING,
          correlationId: prepared.correlationId,
          jobId,
        };
      }

      return {
        ok: true,
        accepted: true,
        messageId: prepared.pending.id,
        conversationId: prepared.conversation.id,
        leadId: prepared.lead.id,
        status: OUTBOUND_MESSAGE_STATUS.PENDING,
        correlationId: prepared.correlationId,
        jobId,
      };
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message.slice(0, 1000) : 'Enqueue failed';
      this.logger.error(
        `outbound enqueue failed messageId=${prepared.pending.id}: ${errorMessage}`,
      );
      await this.prisma.$transaction(async (tx) => {
        await tx.message.update({
          where: { id: prepared.pending.id },
          data: {
            status: OUTBOUND_MESSAGE_STATUS.FAILED,
            failedAt: new Date(),
            errorMessage: `ENQUEUE_FAILED: ${errorMessage}`,
          },
        });
        await this.audit.write(tx, {
          companyId: prepared.companyId,
          actorUserId: actor.sub,
          action: 'WHATSAPP_MESSAGE_FAILED',
          targetType: 'MESSAGE',
          targetId: prepared.pending.id,
          before: {
            status: OUTBOUND_MESSAGE_STATUS.PENDING,
            correlationId: prepared.correlationId,
          },
          after: {
            status: OUTBOUND_MESSAGE_STATUS.FAILED,
            errorMessage: `ENQUEUE_FAILED: ${errorMessage}`,
            correlationId: prepared.correlationId,
          },
          ip: meta?.ip,
          userAgent: meta?.userAgent,
        });
      });
      throw new ServiceUnavailableException({
        message: 'Outbound enqueue failed',
        messageId: prepared.pending.id,
        status: OUTBOUND_MESSAGE_STATUS.FAILED,
        correlationId: prepared.correlationId,
      });
    }
  }

  private async createPendingMessage(
    actor: CompanyActor,
    input: SendWhatsappInput,
  ): Promise<{
    companyId: string;
    actor: CompanyActor;
    lead: { id: string; phone: string };
    conversation: { id: string; leadId: string };
    instance: {
      id: string;
      evolutionInstanceName: string;
      status: WhatsAppConnectionStatus;
    };
    pending: { id: string; conversationId: string; body: string | null };
    body: string;
    correlationId: string;
    source: string;
  }> {
    const companyId = actor.cid;
    const body = input.body.trim();
    if (!body) {
      throw new BadRequestException('body is required');
    }

    // CH5 — fail-fast before PENDING
    this.assertChannelAvailable();

    const lead = await this.prisma.lead.findFirst({
      where: { id: input.leadId, companyId, deletedAt: null },
    });
    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    const conversation = await this.prisma.conversation.findFirst({
      where: { id: input.conversationId, companyId, deletedAt: null },
    });
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    if (conversation.leadId !== lead.id) {
      throw new BadRequestException('conversationId does not belong to leadId');
    }

    if (
      conversation.status === ConversationStatus.CLOSED ||
      conversation.status === ConversationStatus.ARCHIVED
    ) {
      throw new BadRequestException(
        'Conversation is closed; reopen or use an OPEN/IDLE conversation',
      );
    }

    const instance = await this.prisma.whatsAppInstance.findFirst({
      where: { companyId, deletedAt: null },
    });
    if (!instance) {
      throw new ConflictException('WhatsApp instance not found');
    }
    if (instance.status !== WhatsAppConnectionStatus.CONNECTED) {
      throw new ConflictException('WhatsApp instance not CONNECTED');
    }

    const correlationId =
      (typeof input.metadata?.correlationId === 'string' &&
      input.metadata.correlationId.trim()
        ? input.metadata.correlationId.trim()
        : null) ?? newCorrelationId();

    const source = input.metadata?.source?.trim() || 'whatsapp_send';
    const isAiAgent = source === 'ai_agent';
    const extraMeta =
      input.metadata && typeof input.metadata === 'object'
        ? Object.fromEntries(
            Object.entries(input.metadata).filter(
              ([k]) =>
                !['source', 'correlationId', 'followUpId', 'attempt'].includes(
                  k,
                ),
            ),
          )
        : {};
    const messageMetadata: Prisma.InputJsonObject = {
      source,
      correlationId,
      whatsappInstanceId: instance.id,
      evolutionInstanceName: instance.evolutionInstanceName,
      ...(input.metadata?.followUpId
        ? { followUpId: input.metadata.followUpId }
        : {}),
      ...(input.metadata?.attempt !== undefined
        ? { attempt: input.metadata.attempt }
        : {}),
      ...extraMeta,
    };

    // P3-O1 — create PENDING before Evolution call (P4-D4: each send = new Message)
    // 11C AUTO: senderType=AI_AGENT, no human senderUserId.
    const pending = await this.prisma.message.create({
      data: {
        companyId,
        conversationId: conversation.id,
        direction: MessageDirection.OUTBOUND,
        status: OUTBOUND_MESSAGE_STATUS.PENDING,
        body,
        contentType: 'TEXT',
        senderType: isAiAgent ? 'AI_AGENT' : 'USER',
        senderUserId: isAiAgent ? null : actor.sub,
        externalMessageId: null,
        metadata: messageMetadata,
      },
    });

    return {
      companyId,
      actor,
      lead,
      conversation,
      instance,
      pending,
      body,
      correlationId,
      source,
    };
  }

  private async deliverPending(
    prepared: {
      companyId: string;
      actor: CompanyActor;
      lead: { id: string; phone: string };
      conversation: { id: string };
      instance: { evolutionInstanceName: string };
      pending: { id: string };
      body: string;
      correlationId: string;
      source: string;
    },
    actor: CompanyActor,
    meta?: RequestMeta,
  ): Promise<SendWhatsappResult> {
    const {
      companyId,
      lead,
      conversation,
      instance,
      pending,
      body,
      correlationId,
      source,
    } = prepared;

    let externalMessageId: string;
    try {
      const sent = await this.evolution.sendText({
        instanceName: instance.evolutionInstanceName,
        phone: lead.phone,
        text: body,
      });
      externalMessageId = sent.externalMessageId;
    } catch (error) {
      const { errorMessage, httpException } = this.mapSendFailure(
        error,
        pending.id,
        correlationId,
      );

      await this.prisma.$transaction(async (tx) => {
        await tx.message.update({
          where: { id: pending.id },
          data: {
            status: OUTBOUND_MESSAGE_STATUS.FAILED,
            failedAt: new Date(),
            errorMessage,
          },
        });
        await this.audit.write(tx, {
          companyId,
          actorUserId: source === 'ai_agent' ? null : actor.sub,
          action: 'WHATSAPP_MESSAGE_FAILED',
          targetType: 'MESSAGE',
          targetId: pending.id,
          before: {
            status: OUTBOUND_MESSAGE_STATUS.PENDING,
            correlationId,
          },
          after: {
            status: OUTBOUND_MESSAGE_STATUS.FAILED,
            errorMessage,
            correlationId,
            source,
          },
          ip: meta?.ip,
          userAgent: meta?.userAgent,
        });
      });

      this.prom?.recordWhatsappSend(false);
      throw httpException;
    }

    this.prom?.recordWhatsappSend(true);
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.message.update({
        where: { id: pending.id },
        data: {
          status: OUTBOUND_MESSAGE_STATUS.SENT,
          externalMessageId,
          sentAt: now,
          errorMessage: null,
        },
      });

      await tx.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: now },
      });

      await tx.lead.update({
        where: { id: lead.id },
        data: {
          lastOutboundAt: now,
          lastContactAt: now,
        },
      });

      await this.audit.write(tx, {
        companyId,
        actorUserId: source === 'ai_agent' ? null : actor.sub,
        action: 'WHATSAPP_MESSAGE_SENT',
        targetType: 'MESSAGE',
        targetId: pending.id,
        before: {
          status: OUTBOUND_MESSAGE_STATUS.PENDING,
          correlationId,
        },
        after: {
          id: pending.id,
          conversationId: conversation.id,
          leadId: lead.id,
          direction: MessageDirection.OUTBOUND,
          status: OUTBOUND_MESSAGE_STATUS.SENT,
          externalMessageId,
          body: body.slice(0, AUDIT_BODY_MAX),
          source,
          correlationId,
        },
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      });
    });

    return {
      ok: true,
      messageId: pending.id,
      conversationId: conversation.id,
      leadId: lead.id,
      externalMessageId,
      status: OUTBOUND_MESSAGE_STATUS.SENT,
      correlationId,
    };
  }

  private mapSendFailure(
    error: unknown,
    messageId: string,
    correlationId: string,
  ): { errorMessage: string; httpException: HttpException } {
    if (error instanceof ServiceUnavailableException) {
      return {
        errorMessage: EVOLUTION_ERROR_CLASS.CIRCUIT_OPEN,
        httpException: error,
      };
    }

    if (isEvolutionChannelError(error)) {
      const errorMessage = error.toPublicMessage();
      if (error.errorClass === EVOLUTION_ERROR_CLASS.RATE_LIMIT) {
        return {
          errorMessage,
          httpException: new HttpException(
            {
              message: 'WhatsApp rate limited',
              messageId,
              status: OUTBOUND_MESSAGE_STATUS.FAILED,
              error: errorMessage,
              errorClass: error.errorClass,
              correlationId,
            },
            429,
          ),
        };
      }
      if (error.errorClass === EVOLUTION_ERROR_CLASS.CIRCUIT_OPEN) {
        return {
          errorMessage,
          httpException: new ServiceUnavailableException({
            message: 'CHANNEL_UNAVAILABLE',
            messageId,
            status: OUTBOUND_MESSAGE_STATUS.FAILED,
            error: errorMessage,
            errorClass: error.errorClass,
            correlationId,
          }),
        };
      }
      return {
        errorMessage,
        httpException: new BadGatewayException({
          message: 'WhatsApp send failed',
          messageId,
          status: OUTBOUND_MESSAGE_STATUS.FAILED,
          error: errorMessage,
          errorClass: error.errorClass,
          correlationId,
        }),
      };
    }

    const errorMessage =
      error instanceof Error
        ? error.message.slice(0, 1000)
        : 'Evolution send failed';

    return {
      errorMessage,
      httpException: new BadGatewayException({
        message: 'WhatsApp send failed',
        messageId,
        status: OUTBOUND_MESSAGE_STATUS.FAILED,
        error: errorMessage,
        errorClass: EVOLUTION_ERROR_CLASS.UNKNOWN,
        correlationId,
      }),
    };
  }
}

function asJsonObject(value: unknown): Prisma.InputJsonObject {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  return {};
}
