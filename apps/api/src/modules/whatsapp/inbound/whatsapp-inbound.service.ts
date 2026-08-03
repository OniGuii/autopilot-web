import { Injectable, Logger } from '@nestjs/common';
import {
  Channel,
  ConversationStatus,
  LeadStatus,
  MessageDirection,
  Prisma,
  WhatsAppInstance,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import type { ParsedInboundMessage } from './parse-inbound-message';

const AUDIT_BODY_MAX = 2000;

export type InboundProcessResult = {
  messageId: string;
  leadId: string;
  conversationId: string;
  leadCreated: boolean;
  conversationCreated: boolean;
  duplicate?: boolean;
};

/**
 * Extractable inbound handler (design §15) — sync today; queue-ready tomorrow.
 * Tenant must already be resolved; never reads companyId from webhook payload.
 */
@Injectable()
export class WhatsappInboundService {
  private readonly logger = new Logger(WhatsappInboundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async processInboundMessage(
    companyId: string,
    dto: ParsedInboundMessage,
    instance: Pick<WhatsAppInstance, 'id' | 'companyId'>,
  ): Promise<InboundProcessResult> {
    if (instance.companyId !== companyId) {
      // Defense-in-depth: never process under mismatched tenant.
      throw new Error('Tenant mismatch between companyId and instance');
    }

    const existing = await this.prisma.message.findFirst({
      where: {
        companyId,
        externalMessageId: dto.externalMessageId,
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
        messageId: existing.id,
        leadId: existing.conversation.leadId,
        conversationId: existing.conversationId,
        leadCreated: false,
        conversationCreated: false,
        duplicate: true,
      };
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const { lead, leadCreated } = await this.resolveOrCreateLead(
          tx,
          companyId,
          dto,
        );

        const { conversation, conversationCreated } =
          await this.resolveOrCreateConversation(tx, companyId, lead.id, dto);

        const message = await tx.message.create({
          data: {
            companyId,
            conversationId: conversation.id,
            direction: MessageDirection.INBOUND,
            status: 'RECEIVED',
            body: dto.body,
            contentType: 'TEXT',
            senderType: 'LEAD',
            senderUserId: null,
            externalMessageId: dto.externalMessageId,
            sentAt: dto.sentAt,
            metadata: {
              remoteJid: dto.remoteJid,
              pushName: dto.pushName,
              messageType: dto.messageType,
              source: 'evolution_webhook',
              whatsappInstanceId: instance.id,
            },
          },
        });

        const at = dto.sentAt ?? new Date();

        await tx.conversation.update({
          where: { id: conversation.id },
          data: { lastMessageAt: at },
        });

        // P2-T1 timestamps; P2-L2 promote NEW → CONTACTED (created leads already CONTACTED)
        await tx.lead.update({
          where: { id: lead.id },
          data: {
            lastInboundAt: at,
            lastContactAt: at,
            ...(lead.status === LeadStatus.NEW
              ? { status: LeadStatus.CONTACTED }
              : {}),
          },
        });

        if (leadCreated) {
          await this.audit.write(tx, {
            companyId,
            actorUserId: null,
            action: 'LEAD_AUTO_CREATED',
            targetType: 'LEAD',
            targetId: lead.id,
            before: null,
            after: {
              id: lead.id,
              phone: lead.phone,
              status: LeadStatus.CONTACTED,
              source: 'WHATSAPP',
            },
          });
        }

        if (conversationCreated) {
          await this.audit.write(tx, {
            companyId,
            actorUserId: null,
            action: 'CONVERSATION_AUTO_CREATED',
            targetType: 'CONVERSATION',
            targetId: conversation.id,
            before: null,
            after: {
              id: conversation.id,
              leadId: lead.id,
              channel: Channel.WHATSAPP,
              status: ConversationStatus.OPEN,
            },
          });
        }

        await this.audit.write(tx, {
          companyId,
          actorUserId: null,
          action: 'WHATSAPP_MESSAGE_RECEIVED',
          targetType: 'MESSAGE',
          targetId: message.id,
          before: null,
          after: {
            id: message.id,
            conversationId: conversation.id,
            leadId: lead.id,
            direction: MessageDirection.INBOUND,
            externalMessageId: dto.externalMessageId,
            body: dto.body.slice(0, AUDIT_BODY_MAX),
          },
        });

        return {
          messageId: message.id,
          leadId: lead.id,
          conversationId: conversation.id,
          leadCreated,
          conversationCreated,
        };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raced = await this.prisma.message.findFirst({
          where: {
            companyId,
            externalMessageId: dto.externalMessageId,
            deletedAt: null,
          },
          select: {
            id: true,
            conversationId: true,
            conversation: { select: { leadId: true } },
          },
        });
        if (raced) {
          return {
            messageId: raced.id,
            leadId: raced.conversation.leadId,
            conversationId: raced.conversationId,
            leadCreated: false,
            conversationCreated: false,
            duplicate: true,
          };
        }
      }
      this.logger.error(
        `Inbound process failed company=${companyId} ext=${dto.externalMessageId}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  private async resolveOrCreateLead(
    tx: Prisma.TransactionClient,
    companyId: string,
    dto: ParsedInboundMessage,
  ) {
    const existing = await tx.lead.findFirst({
      where: {
        companyId,
        phone: dto.remotePhone,
        deletedAt: null,
      },
    });

    if (existing) {
      // P2-L2: promote NEW → CONTACTED (applied in processInboundMessage update)
      return { lead: existing, leadCreated: false };
    }

    try {
      const created = await tx.lead.create({
        data: {
          companyId,
          phone: dto.remotePhone,
          name: dto.remotePhone,
          status: LeadStatus.CONTACTED, // P2-L1
          ownerId: null,
          score: 0,
          source: 'WHATSAPP',
          lastInboundAt: dto.sentAt,
          lastContactAt: dto.sentAt,
        },
      });
      return { lead: created, leadCreated: true };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raced = await tx.lead.findFirst({
          where: {
            companyId,
            phone: dto.remotePhone,
            deletedAt: null,
          },
        });
        if (raced) {
          return { lead: raced, leadCreated: false };
        }
      }
      throw error;
    }
  }

  private async resolveOrCreateConversation(
    tx: Prisma.TransactionClient,
    companyId: string,
    leadId: string,
    dto: ParsedInboundMessage,
  ) {
    // P2-C1 / D2 — reuse OPEN/IDLE; create when only CLOSED/ARCHIVED
    const open = await tx.conversation.findFirst({
      where: {
        companyId,
        leadId,
        channel: Channel.WHATSAPP,
        deletedAt: null,
        status: {
          in: [ConversationStatus.OPEN, ConversationStatus.IDLE],
        },
      },
      orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
    });

    if (open) {
      return { conversation: open, conversationCreated: false };
    }

    // Avoid partial-unique clash with CLOSED/ARCHIVED rows sharing the same thread id
    const threadId = dto.remoteJid.slice(0, 191);
    const threadTaken = await tx.conversation.findFirst({
      where: {
        companyId,
        channel: Channel.WHATSAPP,
        externalThreadId: threadId,
        deletedAt: null,
      },
      select: { id: true },
    });

    const created = await tx.conversation.create({
      data: {
        companyId,
        leadId,
        channel: Channel.WHATSAPP,
        status: ConversationStatus.OPEN,
        externalThreadId: threadTaken ? null : threadId,
        assignedUserId: null,
        lastMessageAt: dto.sentAt,
      },
    });

    return { conversation: created, conversationCreated: true };
  }
}
