import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Channel, FollowUp, FollowUpStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/types/jwt-payload';
import { WhatsappSendService } from '../whatsapp/outbound/whatsapp-send.service';
import { ApproveFollowUpDto } from './dto/approve-follow-up.dto';
import { CancelFollowUpDto } from './dto/cancel-follow-up.dto';
import { CreateFollowUpDto } from './dto/create-follow-up.dto';
import { ListFollowUpsQueryDto } from './dto/list-follow-ups.query.dto';
import { RejectFollowUpDto } from './dto/reject-follow-up.dto';
import { RescheduleFollowUpDto } from './dto/reschedule-follow-up.dto';
import { UpdateFollowUpDto } from './dto/update-follow-up.dto';
import {
  AI_SUGGESTION_APPROVED,
  AI_SUGGESTION_REJECTED,
  isAiFollowUpMetadata,
} from '../ai/ai.constants';
import {
  FOLLOWUP_EXECUTING_TIMEOUT_MS,
  FOLLOWUP_MAX_ATTEMPTS,
  FOLLOWUP_MESSAGE_SOURCE,
} from './follow-up.constants';

type CompanyActor = AuthenticatedUser & { cid: string; sub: string };

type RequestMeta = {
  ip?: string;
  userAgent?: string;
};

type FollowUpMeta = {
  attemptCount?: number;
  lastError?: string;
  executingTimedOutAt?: string;
};

const AUDIT_BODY_MAX = 2000;
const EDITABLE_STATUSES: FollowUpStatus[] = [
  FollowUpStatus.SUGGESTED,
  FollowUpStatus.APPROVED,
  FollowUpStatus.SCHEDULED,
];
const CANCELABLE_STATUSES: FollowUpStatus[] = [
  FollowUpStatus.SUGGESTED,
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
  attemptCount: number;
  metadata: FollowUpMeta | null;
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
    private readonly whatsappSend: WhatsappSendService,
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
          metadata: { attemptCount: 0 },
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
    let followUp = await this.prisma.followUp.findFirst({
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

    // P4-X1 lazy reconcile
    followUp = (await this.reconcileExecutingTimeout(followUp)) as typeof followUp;

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

  /**
   * P4-A1 — approve always transitions to SCHEDULED.
   */
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

    const scheduledAt =
      dto.scheduledAt ?? existing.scheduledAt ?? new Date();

    return this.prisma.$transaction(async (tx) => {
      const followUp = await tx.followUp.update({
        where: { id: existing.id },
        data: {
          status: FollowUpStatus.SCHEDULED,
          approvedBy: actor.sub,
          approvedAt: new Date(),
          scheduledAt,
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

      if (isAiFollowUpMetadata(existing.metadata)) {
        await this.audit.write(tx, {
          companyId,
          actorUserId: actor.sub,
          action: AI_SUGGESTION_APPROVED,
          targetType: 'FOLLOWUP',
          targetId: followUp.id,
          before: this.snapshot(existing),
          after: this.snapshot(followUp),
          ip: meta?.ip,
          userAgent: meta?.userAgent,
        });
      }

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

      if (isAiFollowUpMetadata(existing.metadata)) {
        await this.audit.write(tx, {
          companyId,
          actorUserId: actor.sub,
          action: AI_SUGGESTION_REJECTED,
          targetType: 'FOLLOWUP',
          targetId: followUp.id,
          before: this.snapshot(existing),
          after: this.snapshot(followUp),
          ip: meta?.ip,
          userAgent: meta?.userAgent,
        });
      }

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

  /**
   * P4-C1 — cancel SUGGESTED | APPROVED | SCHEDULED.
   * EXECUTED (and EXECUTING/FAILED/REJECTED/CANCELLED) not allowed.
   */
  async cancel(
    actor: CompanyActor,
    id: string,
    dto: CancelFollowUpDto,
    meta?: RequestMeta,
  ) {
    const companyId = actor.cid;
    const existing = await this.findActiveInCompany(companyId, id);
    await this.reconcileExecutingTimeout(existing);

    const current = await this.findActiveInCompany(companyId, id);

    if (current.status === FollowUpStatus.EXECUTED) {
      throw new ConflictException('EXECUTED follow-ups cannot be cancelled');
    }

    if (!CANCELABLE_STATUSES.includes(current.status)) {
      throw new ConflictException(
        `Follow-up cannot be cancelled in status ${current.status}`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const followUp = await tx.followUp.update({
        where: { id: current.id },
        data: {
          status: FollowUpStatus.CANCELLED,
          cancelReason: dto.reason?.trim() || null,
        },
      });

      await this.audit.write(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'FOLLOWUP_CANCEL',
        targetType: 'FOLLOWUP',
        targetId: followUp.id,
        before: this.snapshot(current),
        after: this.snapshot(followUp),
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      });

      return this.toResponse(followUp);
    });
  }

  /**
   * SCHEDULED → EXECUTING → WhatsApp send → EXECUTED | FAILED
   * P4-D1/D2/D3 — never creates Message directly; uses WhatsappSendService.
   * P4-F1 — CONNECTED check before EXECUTING.
   */
  async execute(actor: CompanyActor, id: string, meta?: RequestMeta) {
    const companyId = actor.cid;
    let existing = await this.findActiveInCompany(companyId, id);
    existing = await this.reconcileExecutingTimeout(existing);

    if (existing.status !== FollowUpStatus.SCHEDULED) {
      throw new ConflictException(
        'Only SCHEDULED follow-ups can be executed',
      );
    }

    return this.runWhatsAppSend(actor, existing, {
      fromStatus: FollowUpStatus.SCHEDULED,
      isRetry: false,
      meta,
    });
  }

  /**
   * P4-R3 — retry only FAILED; P4-R4 max 3 attempts; P4-D4 new Message each try.
   */
  async retry(actor: CompanyActor, id: string, meta?: RequestMeta) {
    const companyId = actor.cid;
    let existing = await this.findActiveInCompany(companyId, id);
    existing = await this.reconcileExecutingTimeout(existing);

    if (existing.status !== FollowUpStatus.FAILED) {
      throw new ConflictException('Only FAILED follow-ups can be retried');
    }

    const attemptCount = this.getAttemptCount(existing);
    if (attemptCount >= FOLLOWUP_MAX_ATTEMPTS) {
      throw new ConflictException(
        `Maximum of ${FOLLOWUP_MAX_ATTEMPTS} attempts reached`,
      );
    }

    return this.runWhatsAppSend(actor, existing, {
      fromStatus: FollowUpStatus.FAILED,
      isRetry: true,
      meta,
    });
  }

  private async runWhatsAppSend(
    actor: CompanyActor,
    existing: FollowUp,
    opts: {
      fromStatus: FollowUpStatus;
      isRetry: boolean;
      meta?: RequestMeta;
    },
  ) {
    const companyId = actor.cid;

    if (!existing.conversationId) {
      throw new BadRequestException(
        'conversationId is required to execute a follow-up',
      );
    }

    if (!existing.suggestedBody?.trim()) {
      throw new BadRequestException('suggestedBody is required to execute');
    }

    await this.assertConversationForLead(
      companyId,
      existing.conversationId,
      existing.leadId,
    );

    // P4-F1 — 409 without entering EXECUTING
    await this.whatsappSend.assertConnected(companyId);

    const previousAttempts = this.getAttemptCount(existing);
    if (previousAttempts >= FOLLOWUP_MAX_ATTEMPTS) {
      throw new ConflictException(
        `Maximum of ${FOLLOWUP_MAX_ATTEMPTS} attempts reached`,
      );
    }
    const attempt = previousAttempts + 1;

    const claimed = await this.prisma.followUp.updateMany({
      where: {
        id: existing.id,
        companyId,
        status: opts.fromStatus,
        deletedAt: null,
      },
      data: {
        status: FollowUpStatus.EXECUTING,
        metadata: {
          ...this.readMeta(existing),
          attemptCount: attempt,
        } satisfies FollowUpMeta,
        cancelReason: null,
      },
    });

    if (claimed.count !== 1) {
      throw new ConflictException('Follow-up is no longer executable');
    }

    if (opts.isRetry) {
      await this.prisma.$transaction(async (tx) => {
        await this.audit.write(tx, {
          companyId,
          actorUserId: actor.sub,
          action: 'FOLLOWUP_RETRY',
          targetType: 'FOLLOWUP',
          targetId: existing.id,
          before: this.snapshot(existing),
          after: {
            status: FollowUpStatus.EXECUTING,
            attempt,
          },
          ip: opts.meta?.ip,
          userAgent: opts.meta?.userAgent,
        });
      });
    }

    try {
      // P4-D1/D3/D5 — Message created only by Outbound Engine
      const sent = await this.whatsappSend.send(
        actor,
        {
          leadId: existing.leadId,
          conversationId: existing.conversationId,
          body: existing.suggestedBody,
          metadata: {
            source: FOLLOWUP_MESSAGE_SOURCE,
            followUpId: existing.id,
            attempt,
          },
        },
        opts.meta,
      );

      const now = new Date();
      const followUp = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.followUp.update({
          where: { id: existing.id },
          data: {
            status: FollowUpStatus.EXECUTED,
            executedAt: now,
            resultMessageId: sent.messageId,
            metadata: {
              ...this.readMeta(existing),
              attemptCount: attempt,
            },
          },
        });

        await this.audit.write(tx, {
          companyId,
          actorUserId: actor.sub,
          action: 'FOLLOWUP_EXECUTE',
          targetType: 'FOLLOWUP',
          targetId: updated.id,
          before: {
            status: FollowUpStatus.EXECUTING,
            attempt,
          },
          after: this.snapshot(updated),
          ip: opts.meta?.ip,
          userAgent: opts.meta?.userAgent,
        });

        return updated;
      });

      return this.toResponse(followUp);
    } catch (error) {
      const messageId = this.extractFailedMessageId(error);
      const errorMessage = this.extractErrorMessage(error);

      const followUp = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.followUp.update({
          where: { id: existing.id },
          data: {
            status: FollowUpStatus.FAILED,
            resultMessageId: messageId,
            cancelReason: errorMessage.slice(0, 500),
            metadata: {
              ...this.readMeta(existing),
              attemptCount: attempt,
              lastError: errorMessage.slice(0, 1000),
            },
          },
        });

        await this.audit.write(tx, {
          companyId,
          actorUserId: actor.sub,
          action: 'FOLLOWUP_EXECUTE_FAILED',
          targetType: 'FOLLOWUP',
          targetId: updated.id,
          before: {
            status: FollowUpStatus.EXECUTING,
            attempt,
          },
          after: this.snapshot(updated),
          ip: opts.meta?.ip,
          userAgent: opts.meta?.userAgent,
        });

        return updated;
      });

      // Surface original HTTP error when useful (e.g. 502), else 409 conflict-like FAILED
      if (error instanceof ConflictException) {
        throw error;
      }
      if (error instanceof BadGatewayException) {
        throw new BadGatewayException({
          message: 'Follow-up WhatsApp send failed',
          followUpId: followUp.id,
          status: FollowUpStatus.FAILED,
          messageId,
          error: errorMessage,
        });
      }
      if (error instanceof HttpException) {
        throw error;
      }

      throw new BadGatewayException({
        message: 'Follow-up WhatsApp send failed',
        followUpId: followUp.id,
        status: FollowUpStatus.FAILED,
        messageId,
        error: errorMessage,
      });
    }
  }

  /**
   * P4-X1 — if EXECUTING longer than 5 minutes, mark FAILED (lazy).
   */
  private async reconcileExecutingTimeout(followUp: FollowUp): Promise<FollowUp> {
    if (followUp.status !== FollowUpStatus.EXECUTING) {
      return followUp;
    }

    const age = Date.now() - followUp.updatedAt.getTime();
    if (age <= FOLLOWUP_EXECUTING_TIMEOUT_MS) {
      return followUp;
    }

    const meta = this.readMeta(followUp);
    const updated = await this.prisma.followUp.update({
      where: { id: followUp.id },
      data: {
        status: FollowUpStatus.FAILED,
        cancelReason: 'EXECUTING_TIMEOUT',
        metadata: {
          ...meta,
          lastError: 'EXECUTING_TIMEOUT',
          executingTimedOutAt: new Date().toISOString(),
        },
      },
    });

    await this.prisma.$transaction(async (tx) => {
      await this.audit.write(tx, {
        companyId: followUp.companyId,
        actorUserId: null,
        action: 'FOLLOWUP_EXECUTE_FAILED',
        targetType: 'FOLLOWUP',
        targetId: followUp.id,
        before: { status: FollowUpStatus.EXECUTING },
        after: this.snapshot(updated),
      });
    });

    return updated;
  }

  private getAttemptCount(followUp: FollowUp): number {
    const n = this.readMeta(followUp).attemptCount;
    return typeof n === 'number' && n >= 0 ? n : 0;
  }

  private readMeta(followUp: FollowUp): FollowUpMeta {
    if (
      followUp.metadata &&
      typeof followUp.metadata === 'object' &&
      !Array.isArray(followUp.metadata)
    ) {
      return followUp.metadata as FollowUpMeta;
    }
    return {};
  }

  private extractFailedMessageId(error: unknown): string | null {
    if (!(error instanceof HttpException)) return null;
    const res = error.getResponse();
    if (typeof res === 'object' && res !== null && 'messageId' in res) {
      const id = (res as { messageId?: unknown }).messageId;
      return typeof id === 'string' ? id : null;
    }
    return null;
  }

  private extractErrorMessage(error: unknown): string {
    if (error instanceof HttpException) {
      const res = error.getResponse();
      if (typeof res === 'string') return res;
      if (typeof res === 'object' && res !== null) {
        const obj = res as { error?: unknown; message?: unknown };
        if (typeof obj.error === 'string') return obj.error;
        if (typeof obj.message === 'string') return obj.message;
        if (Array.isArray(obj.message)) return obj.message.join(', ');
      }
      return error.message;
    }
    if (error instanceof Error) return error.message;
    return 'Unknown send error';
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
      scheduledAtFilter.not = null;
    }

    if (Object.keys(scheduledAtFilter).length > 0) {
      where.scheduledAt = scheduledAtFilter;
    }

    if (query.overdue === true && query.status) {
      if (
        query.status !== FollowUpStatus.APPROVED &&
        query.status !== FollowUpStatus.SCHEDULED
      ) {
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
      attemptCount: this.getAttemptCount(f),
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
    const meta = this.readMeta(f);
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
      attemptCount: this.getAttemptCount(f),
      metadata: Object.keys(meta).length ? meta : null,
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
