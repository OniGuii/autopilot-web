import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ConversationStatus,
  MessageDirection,
  WhatsAppConnectionStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import type { AuthenticatedUser } from '../../auth/types/jwt-payload';
import { EvolutionClient } from '../evolution.client';
import { OUTBOUND_MESSAGE_STATUS } from './message-status';

type CompanyActor = AuthenticatedUser & { cid: string; sub: string };

type RequestMeta = {
  ip?: string;
  userAgent?: string;
};

const AUDIT_BODY_MAX = 2000;

export type SendWhatsappResult = {
  ok: true;
  messageId: string;
  conversationId: string;
  leadId: string;
  externalMessageId: string;
  status: string;
};

@Injectable()
export class WhatsappSendService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly evolution: EvolutionClient,
  ) {}

  /**
   * Authenticated outbound send.
   * Tenant = JWT.cid only. Never reads companyId from DTO/payload.
   */
  async send(
    actor: CompanyActor,
    input: { leadId: string; conversationId: string; body: string },
    meta?: RequestMeta,
  ): Promise<SendWhatsappResult> {
    const companyId = actor.cid;
    const body = input.body.trim();
    if (!body) {
      throw new BadRequestException('body is required');
    }

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

    // P3-C2 — CLOSED (and ARCHIVED) cannot receive send
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

    // P3-O1 — create PENDING before Evolution call
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
        metadata: {
          source: 'whatsapp_send',
          whatsappInstanceId: instance.id,
          evolutionInstanceName: instance.evolutionInstanceName,
        },
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
      const errorMessage =
        error instanceof Error
          ? error.message.slice(0, 1000)
          : 'Evolution send failed';

      // P3-D1 — keep FAILED row; never delete
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
          before: { status: OUTBOUND_MESSAGE_STATUS.PENDING },
          after: {
            status: OUTBOUND_MESSAGE_STATUS.FAILED,
            errorMessage,
          },
          ip: meta?.ip,
          userAgent: meta?.userAgent,
        });
      });

      throw new BadGatewayException({
        message: 'WhatsApp send failed',
        messageId: pending.id,
        status: OUTBOUND_MESSAGE_STATUS.FAILED,
        error: errorMessage,
      });
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

      // P3-T1
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
        before: { status: OUTBOUND_MESSAGE_STATUS.PENDING },
        after: {
          id: pending.id,
          conversationId: conversation.id,
          leadId: lead.id,
          direction: MessageDirection.OUTBOUND,
          status: OUTBOUND_MESSAGE_STATUS.SENT,
          externalMessageId,
          body: body.slice(0, AUDIT_BODY_MAX),
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
    };
  }
}
