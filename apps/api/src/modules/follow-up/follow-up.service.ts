import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Channel,
  FollowUp,
  FollowUpStatus,
  MessageDirection,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/types/jwt-payload';
import { ApproveFollowUpDto } from './dto/approve-follow-up.dto';
import { CreateFollowUpDto } from './dto/create-follow-up.dto';
import { ListFollowUpsQueryDto } from './dto/list-follow-ups.query.dto';
import { RejectFollowUpDto } from './dto/reject-follow-up.dto';
import { RescheduleFollowUpDto } from './dto/reschedule-follow-up.dto';
import { UpdateFollowUpDto } from './dto/update-follow-up.dto';

type CompanyActor = AuthenticatedUser & { cid: string; sub: string };

type RequestMeta = {
  ip?: string;
  userAgent?: string;
};

const AUDIT_BODY_MAX = 2000;
const EDITABLE_STATUSES: FollowUpStatus[] = [
  FollowUpStatus.SUGGESTED,
  FollowUpStatus.APPROVED,
  FollowUpStatus.SCHEDULED,
];
const EXECUTABLE_STATUSES: FollowUpStatus[] = [
  FollowUpStatus.APPROVED,
  FollowUpStatus.SCHEDULED,
];
const RESCHEDULABLE_STATUSES: FollowUpStatus[] = [
  FollowUpStatus.APPROVED,
  FollowUpStatus.SCHEDULED,
];

export type FollowUpResponse = {
  id: string;
  companyId: string;
  leadId: string;
  conversationId: string | null;
  assignedUserId: string | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  channel: Channel;
  status: FollowUpStatus;
  type: string;
  scheduledAt: Date | null;
  executedAt: Date | null;
  suggestedBody: string | null;
  resultMessageId: string | null;
  cancelReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  lead?: { id: string; name: string | null; phone: string };
  conversation?: { id: string; status: string } | null;
  resultMessage?: {
    id: string;
    body: string | null;
    direction: string;
    sentAt: Date | null;
  } | null;
};

@Injectable()
export class FollowUpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(actor: CompanyActor, dto: CreateFollowUpDto, meta?: RequestMeta) {
    const companyId = actor.cid;
    await this.assertLeadInCompany(companyId, dto.leadId);

    if (dto.conversationId) {
      await this.assertConversationForLead(
        companyId,
        dto.conversationId,
        dto.leadId,
      );
    }

    const assignedUserId =
      dto.assignedUserId === undefined ? null : dto.assignedUserId;
    if (assignedUserId) {
      await this.assertActiveMember(companyId, assignedUserId);
    }

    return this.prisma.$transaction(async (tx) => {
      const followUp = await tx.followUp.create({
        data: {
          companyId,
          leadId: dto.leadId,
          conversationId: dto.conversationId ?? null,
          assignedUserId,
          suggestedBody: dto.suggestedBody,
          type: dto.type ?? 'RECOVERY',
          channel: dto.channel ?? Channel.WHATSAPP,
          scheduledAt: dto.scheduledAt ?? null,
          status: FollowUpStatus.SUGGESTED,
        },
      });

      await this.audit.write(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'FOLLOWUP_CREATE',
        targetType: 'FOLLOWUP',
        targetId: followUp.id,
        before: null,
        after: this.snapshot(followUp),
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      });

      return this.toResponse(followUp);
    });
  }

  async list(actor: CompanyActor, query: ListFollowUpsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = this.buildListWhere(actor.cid, query);

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.followUp.count({ where }),
      this.prisma.followUp.findMany({
        where,
        include: {
          lead: { select: { id: true, name: true, phone: true } },
        },
        orderBy: [
          { scheduledAt: { sort: 'asc', nulls: 'last' } },
          { createdAt: 'desc' },
        ],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      data: rows.map((row) =>
        this.toResponse(row, {
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
    const followUp = await this.prisma.followUp.findFirst({
      where: { id, companyId: actor.cid, deletedAt: null },
      include: {
        lead: { select: { id: true, name: true, phone: true } },
        conversation: { select: { id: true, status: true } },
        resultMessage: {
          select: { id: true, body: true, direction: true, sentAt: true },
        },
      },
    });

    if (!followUp) {
      throw new NotFoundException('Follow-up not found');
    }

    return this.toResponse(followUp, {
      lead: followUp.lead,
      conversation: followUp.conversation,
      resultMessage: followUp.resultMessage,
    });
  }

  async update(
    actor: CompanyActor,
    id: string,
    dto: UpdateFollowUpDto,
    meta?: RequestMeta,
  ) {
    const companyId = actor.cid;
    const existing = await this.findActiveInCompany(companyId, id);

    if (!EDITABLE_STATUSES.includes(existing.status)) {
      throw new ConflictException(
        `Follow-up cannot be updated in status ${existing.status}`,
      );
    }

    if (
      dto.suggestedBody !== undefined &&
      existing.status !== FollowUpStatus.SUGGESTED
    ) {
      throw new ConflictException(
        'suggestedBody can only be updated while SUGGESTED',
      );
    }

    if (
      dto.type !== undefined &&
      existing.status !== FollowUpStatus.SUGGESTED
    ) {
      throw new ConflictException('type can only be updated while SUGGESTED');
    }

    if (dto.assignedUserId) {
      await this.assertActiveMember(companyId, dto.assignedUserId);
    }

    if (dto.conversationId) {
      await this.assertConversationForLead(
        companyId,
        dto.conversationId,
        existing.leadId,
      );
    }

    const data: Prisma.FollowUpUpdateInput = {};
    if (dto.suggestedBody !== undefined) data.suggestedBody = dto.suggestedBody;
    if (dto.scheduledAt !== undefined) data.scheduledAt = dto.scheduledAt;
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.assignedUserId !== undefined) {
      data.assignedUser =
        dto.assignedUserId === null
          ? { disconnect: true }
          : { connect: { id: dto.assignedUserId } };
    }
    if (dto.conversationId !== undefined) {
      data.conversation =
        dto.conversationId === null
          ? { disconnect: true }
          : { connect: { id: dto.conversationId } };
    }

    return this.prisma.$transaction(async (tx) => {
      const followUp = await tx.followUp.update({
        where: { id: existing.id },
        data,
      });

      await this.audit.write(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'FOLLOWUP_UPDATE',
        targetType: 'FOLLOWUP',
        targetId: followUp.id,
        before: this.snapshot(existing),
        after: this.snapshot(followUp),
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      });

      return this.toResponse(followUp);
    });
  }

  async approve(
    actor: CompanyActor,
    id: string,
    dto: ApproveFollowUpDto,
    meta?: RequestMeta,
  ) {
    const companyId = actor.cid;
    const existing = await this.findActiveInCompany(companyId, id);

    if (existing.status !== FollowUpStatus.SUGGESTED) {
      throw new ConflictException('Only SUGGESTED follow-ups can be approved');
    }

    return this.prisma.$transaction(async (tx) => {
      const followUp = await tx.followUp.update({
        where: { id: existing.id },
        data: {
          status: FollowUpStatus.APPROVED,
          approvedBy: actor.sub,
          approvedAt: new Date(),
          ...(dto.scheduledAt !== undefined
            ? { scheduledAt: dto.scheduledAt }
            : {}),
        },
      });

      await this.audit.write(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'FOLLOWUP_APPROVE',
        targetType: 'FOLLOWUP',
        targetId: followUp.id,
        before: this.snapshot(existing),
        after: this.snapshot(followUp),
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      });

      return this.toResponse(followUp);
    });
  }

  async reject(
    actor: CompanyActor,
    id: string,
    dto: RejectFollowUpDto,
    meta?: RequestMeta,
  ) {
    const companyId = actor.cid;
    const existing = await this.findActiveInCompany(companyId, id);

    if (existing.status !== FollowUpStatus.SUGGESTED) {
      throw new ConflictException('Only SUGGESTED follow-ups can be rejected');
    }

    return this.prisma.$transaction(async (tx) => {
      const followUp = await tx.followUp.update({
        where: { id: existing.id },
        data: {
          status: FollowUpStatus.REJECTED,
          cancelReason: dto.reason,
        },
      });

      await this.audit.write(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'FOLLOWUP_REJECT',
        targetType: 'FOLLOWUP',
        targetId: followUp.id,
        before: this.snapshot(existing),
        after: this.snapshot(followUp),
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      });

      return this.toResponse(followUp);
    });
  }

  async reschedule(
    actor: CompanyActor,
    id: string,
    dto: RescheduleFollowUpDto,
    meta?: RequestMeta,
  ) {
    const companyId = actor.cid;
    const existing = await this.findActiveInCompany(companyId, id);

    if (!RESCHEDULABLE_STATUSES.includes(existing.status)) {
      throw new ConflictException(
        'Only APPROVED or SCHEDULED follow-ups can be rescheduled',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const followUp = await tx.followUp.update({
        where: { id: existing.id },
        data: {
          status: FollowUpStatus.SCHEDULED,
          scheduledAt: dto.scheduledAt,
        },
      });

      await this.audit.write(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'FOLLOWUP_RESCHEDULE',
        targetType: 'FOLLOWUP',
        targetId: followUp.id,
        before: this.snapshot(existing),
        after: this.snapshot(followUp),
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      });

      return this.toResponse(followUp);
    });
  }

  async execute(actor: CompanyActor, id: string, meta?: RequestMeta) {
    const companyId = actor.cid;
    const existing = await this.findActiveInCompany(companyId, id);

    if (!EXECUTABLE_STATUSES.includes(existing.status)) {
      throw new ConflictException(
        'Only APPROVED or SCHEDULED follow-ups can be executed',
      );
    }

    if (!existing.conversationId) {
      throw new BadRequestException(
        'conversationId is required to execute a follow-up',
      );
    }

    if (!existing.suggestedBody?.trim()) {
      throw new BadRequestException('suggestedBody is required to execute');
    }

    const conversation = await this.assertConversationForLead(
      companyId,
      existing.conversationId,
      existing.leadId,
    );

    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      // Conditional update to prevent double-execute races
      const updated = await tx.followUp.updateMany({
        where: {
          id: existing.id,
          companyId,
          status: { in: EXECUTABLE_STATUSES },
          deletedAt: null,
        },
        data: {
          status: FollowUpStatus.EXECUTED,
          executedAt: now,
        },
      });

      if (updated.count !== 1) {
        throw new ConflictException('Follow-up is no longer executable');
      }

      const message = await tx.message.create({
        data: {
          companyId,
          conversationId: conversation.id,
          direction: MessageDirection.OUTBOUND,
          body: existing.suggestedBody,
          status: 'SENT',
          contentType: 'TEXT',
          senderType: 'USER',
          senderUserId: actor.sub,
          sentAt: now,
        },
      });

      await tx.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: now },
      });

      const followUp = await tx.followUp.update({
        where: { id: existing.id },
        data: { resultMessageId: message.id },
      });

      await this.audit.write(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'FOLLOWUP_EXECUTE',
        targetType: 'FOLLOWUP',
        targetId: followUp.id,
        before: this.snapshot(existing),
        after: this.snapshot(followUp),
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      });

      await this.audit.write(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'MESSAGE_CREATE',
        targetType: 'MESSAGE',
        targetId: message.id,
        before: null,
        after: {
          id: message.id,
          companyId: message.companyId,
          conversationId: message.conversationId,
          direction: message.direction,
          status: message.status,
          body: this.truncateBody(message.body),
          senderType: message.senderType,
          senderUserId: message.senderUserId,
          sentAt: message.sentAt?.toISOString() ?? null,
          followUpId: followUp.id,
        },
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      });

      return this.toResponse(followUp);
    });
  }

  private buildListWhere(
    companyId: string,
    query: ListFollowUpsQueryDto,
  ): Prisma.FollowUpWhereInput {
    const where: Prisma.FollowUpWhereInput = {
      companyId,
      deletedAt: null,
    };

    if (query.status) where.status = query.status;
    if (query.leadId) where.leadId = query.leadId;
    if (query.assignedUserId) where.assignedUserId = query.assignedUserId;

    const scheduledAtFilter: Prisma.DateTimeNullableFilter = {};
    if (query.scheduledFrom) scheduledAtFilter.gte = query.scheduledFrom;
    if (query.scheduledTo) scheduledAtFilter.lte = query.scheduledTo;

    if (query.overdue === true) {
      where.status = {
        in: [FollowUpStatus.APPROVED, FollowUpStatus.SCHEDULED],
      };
      scheduledAtFilter.lt = new Date();
      // overdue implies scheduledAt is set
      scheduledAtFilter.not = null;
    }

    if (Object.keys(scheduledAtFilter).length > 0) {
      where.scheduledAt = scheduledAtFilter;
    }

    // Explicit status filter wins over overdue status set if both passed —
    // if both provided, intersect: require the explicit status to be overdue-eligible
    if (query.overdue === true && query.status) {
      if (
        query.status !== FollowUpStatus.APPROVED &&
        query.status !== FollowUpStatus.SCHEDULED
      ) {
        // impossible combo → empty result
        where.id = '00000000-0000-4000-8000-000000000000';
      } else {
        where.status = query.status;
      }
    }

    return where;
  }

  private async findActiveInCompany(
    companyId: string,
    id: string,
  ): Promise<FollowUp> {
    const followUp = await this.prisma.followUp.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!followUp) {
      throw new NotFoundException('Follow-up not found');
    }
    return followUp;
  }

  private async assertLeadInCompany(companyId: string, leadId: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!lead) {
      throw new NotFoundException('Lead not found');
    }
  }

  private async assertConversationForLead(
    companyId: string,
    conversationId: string,
    leadId: string,
  ) {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        companyId,
        leadId,
        deletedAt: null,
      },
      select: { id: true, companyId: true, leadId: true },
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

  private snapshot(f: FollowUp): Prisma.InputJsonValue {
    return {
      id: f.id,
      companyId: f.companyId,
      leadId: f.leadId,
      conversationId: f.conversationId,
      status: f.status,
      type: f.type,
      suggestedBody: this.truncateBody(f.suggestedBody),
      scheduledAt: f.scheduledAt?.toISOString() ?? null,
      assignedUserId: f.assignedUserId,
      approvedBy: f.approvedBy,
      approvedAt: f.approvedAt?.toISOString() ?? null,
      executedAt: f.executedAt?.toISOString() ?? null,
      resultMessageId: f.resultMessageId,
      cancelReason: f.cancelReason,
      deletedAt: f.deletedAt?.toISOString() ?? null,
    };
  }

  private toResponse(
    f: FollowUp,
    extras?: {
      lead?: { id: string; name: string | null; phone: string };
      conversation?: { id: string; status: string } | null;
      resultMessage?: {
        id: string;
        body: string | null;
        direction: string;
        sentAt: Date | null;
      } | null;
    },
  ): FollowUpResponse {
    return {
      id: f.id,
      companyId: f.companyId,
      leadId: f.leadId,
      conversationId: f.conversationId,
      assignedUserId: f.assignedUserId,
      approvedBy: f.approvedBy,
      approvedAt: f.approvedAt,
      channel: f.channel,
      status: f.status,
      type: f.type,
      scheduledAt: f.scheduledAt,
      executedAt: f.executedAt,
      suggestedBody: f.suggestedBody,
      resultMessageId: f.resultMessageId,
      cancelReason: f.cancelReason,
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
      ...(extras?.lead ? { lead: extras.lead } : {}),
      ...(extras && 'conversation' in extras
        ? { conversation: extras.conversation ?? null }
        : {}),
      ...(extras && 'resultMessage' in extras
        ? { resultMessage: extras.resultMessage ?? null }
        : {}),
    };
  }
}
