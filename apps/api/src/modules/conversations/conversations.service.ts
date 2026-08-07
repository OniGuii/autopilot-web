import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Channel,
  Conversation,
  ConversationStatus,
  FollowUpStatus,
  Message,
  MessageDirection,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AI_FOLLOWUP_TYPE } from '../ai/ai.constants';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/types/jwt-payload';
import { normalizePhone } from '../leads/utils/normalize-phone';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import { ListConversationsQueryDto } from './dto/list-conversations.query.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';

type CompanyActor = AuthenticatedUser & { cid: string; sub: string };

type RequestMeta = {
  ip?: string;
  userAgent?: string;
};

const MESSAGE_PAGE_LIMIT = 50;
const AUDIT_BODY_MAX = 2000;

type LeadSummary = {
  id: string;
  name: string | null;
  phone: string;
};

export type AiSuggestionCard = {
  followUpId: string;
  suggestedBody: string | null;
  status: FollowUpStatus;
  intent: string | null;
  confidence: number | null;
  requiresHuman: boolean;
  kbSource: string | null;
  kbTitle: string | null;
  createdAt: Date;
};

export type ConversationResponse = {
  id: string;
  companyId: string;
  leadId: string;
  channel: Channel;
  status: ConversationStatus;
  assignedUserId: string | null;
  externalThreadId: string | null;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lead?: LeadSummary;
  messages?: MessageResponse[];
  /** Latest SUGGESTED AI_REPLY for ASSIST UI (Fase 11B). */
  aiSuggestion?: AiSuggestionCard | null;
};

export type MessageResponse = {
  id: string;
  companyId: string;
  conversationId: string;
  direction: MessageDirection;
  status: string;
  body: string | null;
  contentType: string;
  senderType: string;
  senderUserId: string | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(
    actor: CompanyActor,
    dto: CreateConversationDto,
    meta?: RequestMeta,
  ) {
    const companyId = actor.cid;
    const lead = await this.prisma.lead.findFirst({
      where: { id: dto.leadId, companyId, deletedAt: null },
      select: { id: true, companyId: true },
    });

    if (!lead || lead.companyId !== companyId) {
      throw new NotFoundException('Lead not found');
    }

    const assignedUserId =
      dto.assignedUserId === undefined ? null : dto.assignedUserId;
    if (assignedUserId) {
      await this.assertActiveMember(companyId, assignedUserId);
    }

    return this.prisma.$transaction(async (tx) => {
      const conversation = await tx.conversation.create({
        data: {
          companyId,
          leadId: lead.id,
          channel: dto.channel ?? Channel.WHATSAPP,
          status: dto.status ?? ConversationStatus.OPEN,
          assignedUserId,
          externalThreadId: dto.externalThreadId ?? null,
        },
      });

      await this.audit.write(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'CONVERSATION_CREATE',
        targetType: 'CONVERSATION',
        targetId: conversation.id,
        before: null,
        after: this.conversationSnapshot(conversation),
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      });

      return this.toConversationResponse(conversation);
    });
  }

  async list(actor: CompanyActor, query: ListConversationsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = this.buildListWhere(actor.cid, query);

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.conversation.count({ where }),
      this.prisma.conversation.findMany({
        where,
        include: {
          lead: { select: { id: true, name: true, phone: true } },
        },
        orderBy: [
          { lastMessageAt: { sort: 'desc', nulls: 'last' } },
          { createdAt: 'desc' },
        ],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      data: rows.map((row) =>
        this.toConversationResponse(row, {
          lead: row.lead,
        }),
      ),
      meta: {
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    };
  }

  async findOne(actor: CompanyActor, id: string) {
    const conversation = await this.findActiveInCompany(actor.cid, id, {
      lead: true,
    });

    const [messages, aiFollowUp] = await Promise.all([
      this.prisma.message.findMany({
        where: {
          conversationId: conversation.id,
          companyId: actor.cid,
          deletedAt: null,
        },
        orderBy: { createdAt: 'desc' },
        take: MESSAGE_PAGE_LIMIT,
      }),
      this.prisma.followUp.findFirst({
        where: {
          companyId: actor.cid,
          conversationId: conversation.id,
          deletedAt: null,
          type: AI_FOLLOWUP_TYPE,
          status: FollowUpStatus.SUGGESTED,
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    // Return chronological order (oldest → newest) among the last 50
    messages.reverse();

    return this.toConversationResponse(conversation, {
      lead: {
        id: conversation.lead.id,
        name: conversation.lead.name,
        phone: conversation.lead.phone,
      },
      messages: messages.map((m) => this.toMessageResponse(m)),
      aiSuggestion: this.toAiSuggestionCard(aiFollowUp),
    });
  }

  async update(
    actor: CompanyActor,
    id: string,
    dto: UpdateConversationDto,
    meta?: RequestMeta,
  ) {
    const companyId = actor.cid;
    const existing = await this.findActiveInCompany(companyId, id);

    if (dto.assignedUserId) {
      await this.assertActiveMember(companyId, dto.assignedUserId);
    }

    const data: Prisma.ConversationUpdateInput = {};
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.channel !== undefined) data.channel = dto.channel;
    if (dto.externalThreadId !== undefined) {
      data.externalThreadId = dto.externalThreadId;
    }
    if (dto.assignedUserId !== undefined) {
      data.assignedUser =
        dto.assignedUserId === null
          ? { disconnect: true }
          : { connect: { id: dto.assignedUserId } };
    }

    return this.prisma.$transaction(async (tx) => {
      const conversation = await tx.conversation.update({
        where: { id: existing.id },
        data,
      });

      await this.audit.write(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'CONVERSATION_UPDATE',
        targetType: 'CONVERSATION',
        targetId: conversation.id,
        before: this.conversationSnapshot(existing),
        after: this.conversationSnapshot(conversation),
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      });

      return this.toConversationResponse(conversation);
    });
  }

  async close(actor: CompanyActor, id: string, meta?: RequestMeta) {
    const companyId = actor.cid;
    const existing = await this.findActiveInCompany(companyId, id);

    if (existing.status === ConversationStatus.CLOSED) {
      return this.toConversationResponse(existing);
    }

    return this.prisma.$transaction(async (tx) => {
      const conversation = await tx.conversation.update({
        where: { id: existing.id },
        data: { status: ConversationStatus.CLOSED },
      });

      await this.audit.write(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'CONVERSATION_CLOSE',
        targetType: 'CONVERSATION',
        targetId: conversation.id,
        before: this.conversationSnapshot(existing),
        after: this.conversationSnapshot(conversation),
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      });

      return this.toConversationResponse(conversation);
    });
  }

  async createMessage(
    actor: CompanyActor,
    conversationId: string,
    dto: CreateMessageDto,
    meta?: RequestMeta,
  ) {
    const companyId = actor.cid;
    const conversation = await this.findActiveInCompany(
      companyId,
      conversationId,
    );

    let senderUserId: string | null = null;
    let senderType: string;
    let status: string;

    if (dto.direction === MessageDirection.INBOUND) {
      // cliente → empresa
      if (dto.senderUserId) {
        throw new BadRequestException(
          'senderUserId is not allowed for INBOUND messages',
        );
      }
      senderUserId = null;
      senderType = 'LEAD';
      status = 'RECEIVED';
    } else {
      // OUTBOUND = empresa → cliente
      senderUserId = dto.senderUserId ?? actor.sub;
      await this.assertActiveMember(companyId, senderUserId);
      senderType = 'USER';
      status = 'SENT';
    }

    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const message = await tx.message.create({
        data: {
          companyId,
          conversationId: conversation.id,
          direction: dto.direction,
          body: dto.body,
          status,
          contentType: 'TEXT',
          senderType,
          senderUserId,
          sentAt: now,
        },
      });

      await tx.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: now },
      });

      await this.audit.write(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'MESSAGE_CREATE',
        targetType: 'MESSAGE',
        targetId: message.id,
        before: null,
        after: this.messageSnapshot(message),
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      });

      return this.toMessageResponse(message);
    });
  }

  private buildListWhere(
    companyId: string,
    query: ListConversationsQueryDto,
  ): Prisma.ConversationWhereInput {
    const where: Prisma.ConversationWhereInput = {
      companyId,
      deletedAt: null,
    };

    if (query.status) where.status = query.status;
    if (query.leadId) where.leadId = query.leadId;
    if (query.assignedUserId) where.assignedUserId = query.assignedUserId;

    if (query.search?.trim()) {
      const term = query.search.trim();
      const digits = normalizePhone(term);
      where.lead = {
        deletedAt: null,
        OR: [
          { name: { contains: term, mode: 'insensitive' } },
          ...(digits
            ? [{ phone: { contains: digits, mode: 'insensitive' as const } }]
            : [{ phone: { contains: term, mode: 'insensitive' as const } }]),
        ],
      };
    }

    return where;
  }

  private async findActiveInCompany(
    companyId: string,
    id: string,
  ): Promise<Conversation>;
  private async findActiveInCompany(
    companyId: string,
    id: string,
    include: { lead: true },
  ): Promise<Conversation & { lead: LeadSummary & { name: string | null } }>;
  private async findActiveInCompany(
    companyId: string,
    id: string,
    include?: { lead: true },
  ) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, companyId, deletedAt: null },
      include: include?.lead
        ? { lead: { select: { id: true, name: true, phone: true } } }
        : undefined,
    });
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }
    return conversation;
  }

  private async assertActiveMember(companyId: string, userId: string) {
    const membership = await this.prisma.membership.findFirst({
      where: {
        companyId,
        userId,
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!membership) {
      throw new BadRequestException(
        'User must be an active member of this company',
      );
    }
  }

  private truncateBody(body: string | null): string | null {
    if (body == null) return null;
    if (body.length <= AUDIT_BODY_MAX) return body;
    return `${body.slice(0, AUDIT_BODY_MAX)}…`;
  }

  private conversationSnapshot(c: Conversation): Prisma.InputJsonValue {
    return {
      id: c.id,
      companyId: c.companyId,
      leadId: c.leadId,
      channel: c.channel,
      status: c.status,
      assignedUserId: c.assignedUserId,
      externalThreadId: c.externalThreadId,
      lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
      deletedAt: c.deletedAt?.toISOString() ?? null,
    };
  }

  private messageSnapshot(m: Message): Prisma.InputJsonValue {
    return {
      id: m.id,
      companyId: m.companyId,
      conversationId: m.conversationId,
      direction: m.direction,
      status: m.status,
      body: this.truncateBody(m.body),
      senderType: m.senderType,
      senderUserId: m.senderUserId,
      sentAt: m.sentAt?.toISOString() ?? null,
    };
  }

  private toConversationResponse(
    c: Conversation,
    extras?: {
      lead?: LeadSummary;
      messages?: MessageResponse[];
      aiSuggestion?: AiSuggestionCard | null;
    },
  ): ConversationResponse {
    return {
      id: c.id,
      companyId: c.companyId,
      leadId: c.leadId,
      channel: c.channel,
      status: c.status,
      assignedUserId: c.assignedUserId,
      externalThreadId: c.externalThreadId,
      lastMessageAt: c.lastMessageAt,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      ...(extras?.lead ? { lead: extras.lead } : {}),
      ...(extras?.messages ? { messages: extras.messages } : {}),
      ...(extras && 'aiSuggestion' in extras
        ? { aiSuggestion: extras.aiSuggestion ?? null }
        : {}),
    };
  }

  private toAiSuggestionCard(
    followUp: {
      id: string;
      suggestedBody: string | null;
      status: FollowUpStatus;
      metadata: Prisma.JsonValue;
      createdAt: Date;
    } | null,
  ): AiSuggestionCard | null {
    if (!followUp) return null;
    const meta =
      followUp.metadata &&
      typeof followUp.metadata === 'object' &&
      !Array.isArray(followUp.metadata)
        ? (followUp.metadata as Record<string, unknown>)
        : {};
    const kb =
      meta.kb && typeof meta.kb === 'object' && !Array.isArray(meta.kb)
        ? (meta.kb as Record<string, unknown>)
        : null;

    return {
      followUpId: followUp.id,
      suggestedBody: followUp.suggestedBody,
      status: followUp.status,
      intent: typeof meta.intent === 'string' ? meta.intent : null,
      confidence: typeof meta.confidence === 'number' ? meta.confidence : null,
      requiresHuman: meta.requiresHuman === true,
      kbSource:
        typeof kb?.source === 'string'
          ? kb.source
          : typeof kb?.title === 'string'
            ? kb.title
            : null,
      kbTitle: typeof kb?.title === 'string' ? kb.title : null,
      createdAt: followUp.createdAt,
    };
  }

  private toMessageResponse(m: Message): MessageResponse {
    return {
      id: m.id,
      companyId: m.companyId,
      conversationId: m.conversationId,
      direction: m.direction,
      status: m.status,
      body: m.body,
      contentType: m.contentType,
      senderType: m.senderType,
      senderUserId: m.senderUserId,
      sentAt: m.sentAt,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    };
  }
}
