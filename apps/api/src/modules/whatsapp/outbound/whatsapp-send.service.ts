import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ConversationStatus,
  MessageDirection,
  Prisma,
  WhatsAppConnectionStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
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

@Injectable()
export class WhatsappSendService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly evolution: EvolutionClient,
  ) {}

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
   * Authenticated outbound send.
   * Tenant = JWT.cid only. Never reads companyId from DTO/payload.
   * P4-D1: FollowUp must call this — never create Message directly.
   */
  async send(
    actor: CompanyActor,
    input: SendWhatsappInput,
    meta?: RequestMeta,
  ): Promise<SendWhatsappResult> {
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
      throw new BadRequestException(
        'conversationId does not belong to leadId',
      );
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
    };

    // P3-O1 — create PENDING before Evolution call (P4-D4: each send = new Message)
    const pending = await this.prisma.message.create({
      data: {
        companyId,
        conversationId: conversation.id,
        direction: MessageDirection.OUTBOUND,
        status: OUTBOUND_MESSAGE_STATUS.PENDING,
        body,
        contentType: 'TEXT',
        senderType: 'USER',
        senderUserId: actor.sub,
        externalMessageId: null,
        metadata: messageMetadata,
      },
    });

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
          actorUserId: actor.sub,
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
          },
          ip: meta?.ip,
          userAgent: meta?.userAgent,
        });
      });

      throw httpException;
    }

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
        actorUserId: actor.sub,
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
