import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LeadActivity, LeadActivityStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/types/jwt-payload';
import { CreateLeadActivityDto } from './dto/create-lead-activity.dto';
import { ListLeadActivitiesQueryDto } from './dto/list-lead-activities.query.dto';
import { UpdateLeadActivityDto } from './dto/update-lead-activity.dto';

type CompanyActor = AuthenticatedUser & { cid: string; sub: string };

type RequestMeta = {
  ip?: string;
  userAgent?: string;
};

export type LeadActivityResponse = {
  id: string;
  companyId: string;
  leadId: string;
  userId: string | null;
  type: LeadActivity['type'];
  status: LeadActivityStatus;
  title: string;
  body: string | null;
  scheduledAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const TERMINAL: LeadActivityStatus[] = [
  LeadActivityStatus.DONE,
  LeadActivityStatus.CANCELLED,
];

@Injectable()
export class LeadActivitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(
    actor: CompanyActor,
    leadId: string,
    dto: CreateLeadActivityDto,
    meta?: RequestMeta,
  ) {
    const companyId = actor.cid;
    await this.assertLeadInCompany(companyId, leadId);

    const userId =
      dto.userId === undefined
        ? actor.sub
        : dto.userId === null
          ? null
          : dto.userId;
    if (userId) {
      await this.assertActiveMember(companyId, userId);
    }

    return this.prisma.$transaction(async (tx) => {
      const activity = await tx.leadActivity.create({
        data: {
          companyId,
          leadId,
          userId,
          type: dto.type,
          title: dto.title,
          body: dto.body ?? null,
          scheduledAt: dto.scheduledAt ?? null,
          status: LeadActivityStatus.PLANNED,
        },
      });
      await this.audit.write(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'ACTIVITY_CREATE',
        targetType: 'LEAD_ACTIVITY',
        targetId: activity.id,
        before: null,
        after: this.snapshot(activity),
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      });
      return this.toResponse(activity);
    });
  }

  async list(
    actor: CompanyActor,
    leadId: string,
    query: ListLeadActivitiesQueryDto,
  ) {
    const companyId = actor.cid;
    await this.assertLeadInCompany(companyId, leadId);

    const rows = await this.prisma.leadActivity.findMany({
      where: {
        companyId,
        leadId,
        deletedAt: null,
        ...(query.status ? { status: query.status } : {}),
        ...(query.type ? { type: query.type } : {}),
      },
      orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'desc' }],
    });
    return rows.map((row) => this.toResponse(row));
  }

  async findOne(actor: CompanyActor, leadId: string, id: string) {
    const activity = await this.findActive(actor.cid, leadId, id);
    return this.toResponse(activity);
  }

  async update(
    actor: CompanyActor,
    leadId: string,
    id: string,
    dto: UpdateLeadActivityDto,
    meta?: RequestMeta,
  ) {
    const companyId = actor.cid;
    const existing = await this.findActive(companyId, leadId, id);

    if (TERMINAL.includes(existing.status)) {
      throw new BadRequestException('DONE/CANCELLED activities are immutable');
    }

    if (dto.userId) {
      await this.assertActiveMember(companyId, dto.userId);
    }

    let nextStatus = existing.status;
    let completedAt: Date | null | undefined = undefined;
    let auditAction = 'ACTIVITY_UPDATE';

    if (dto.status !== undefined && dto.status !== existing.status) {
      this.assertStatusTransition(existing.status, dto.status);
      nextStatus = dto.status;
      if (dto.status === LeadActivityStatus.DONE) {
        completedAt = new Date();
        auditAction = 'ACTIVITY_COMPLETE';
      } else if (dto.status === LeadActivityStatus.CANCELLED) {
        auditAction = 'ACTIVITY_CANCEL';
      }
    }

    const data: Prisma.LeadActivityUpdateInput = {};
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.body !== undefined) data.body = dto.body;
    if (dto.scheduledAt !== undefined) data.scheduledAt = dto.scheduledAt;
    if (dto.userId !== undefined) {
      data.user =
        dto.userId === null
          ? { disconnect: true }
          : { connect: { id: dto.userId } };
    }
    if (dto.status !== undefined) data.status = nextStatus;
    if (completedAt !== undefined) data.completedAt = completedAt;

    return this.prisma.$transaction(async (tx) => {
      const activity = await tx.leadActivity.update({
        where: { id: existing.id },
        data,
      });
      await this.audit.write(tx, {
        companyId,
        actorUserId: actor.sub,
        action: auditAction,
        targetType: 'LEAD_ACTIVITY',
        targetId: activity.id,
        before: this.snapshot(existing),
        after: this.snapshot(activity),
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      });
      return this.toResponse(activity);
    });
  }

  async complete(
    actor: CompanyActor,
    leadId: string,
    id: string,
    meta?: RequestMeta,
  ) {
    return this.update(
      actor,
      leadId,
      id,
      { status: LeadActivityStatus.DONE },
      meta,
    );
  }

  async cancel(
    actor: CompanyActor,
    leadId: string,
    id: string,
    meta?: RequestMeta,
  ) {
    return this.update(
      actor,
      leadId,
      id,
      { status: LeadActivityStatus.CANCELLED },
      meta,
    );
  }

  async remove(
    actor: CompanyActor,
    leadId: string,
    id: string,
    meta?: RequestMeta,
  ): Promise<void> {
    const companyId = actor.cid;
    const existing = await this.findActive(companyId, leadId, id);
    const deletedAt = new Date();

    await this.prisma.$transaction(async (tx) => {
      const activity = await tx.leadActivity.update({
        where: { id: existing.id },
        data: { deletedAt },
      });
      await this.audit.write(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'ACTIVITY_UPDATE',
        targetType: 'LEAD_ACTIVITY',
        targetId: activity.id,
        before: this.snapshot(existing),
        after: this.snapshot(activity),
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      });
    });
  }

  private assertStatusTransition(
    from: LeadActivityStatus,
    to: LeadActivityStatus,
  ) {
    if (from !== LeadActivityStatus.PLANNED) {
      throw new BadRequestException(
        'Only PLANNED activities can change status',
      );
    }
    if (to !== LeadActivityStatus.DONE && to !== LeadActivityStatus.CANCELLED) {
      throw new BadRequestException(
        'PLANNED may only transition to DONE or CANCELLED',
      );
    }
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

  private async findActive(
    companyId: string,
    leadId: string,
    id: string,
  ): Promise<LeadActivity> {
    await this.assertLeadInCompany(companyId, leadId);
    const activity = await this.prisma.leadActivity.findFirst({
      where: { id, companyId, leadId, deletedAt: null },
    });
    if (!activity) {
      throw new NotFoundException('Activity not found');
    }
    return activity;
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
        'userId must be an active member of this company',
      );
    }
  }

  private snapshot(activity: LeadActivity): Prisma.InputJsonValue {
    return {
      id: activity.id,
      companyId: activity.companyId,
      leadId: activity.leadId,
      userId: activity.userId,
      type: activity.type,
      status: activity.status,
      title: activity.title,
      body: activity.body?.slice(0, 2000) ?? null,
      scheduledAt: activity.scheduledAt?.toISOString() ?? null,
      completedAt: activity.completedAt?.toISOString() ?? null,
      deletedAt: activity.deletedAt?.toISOString() ?? null,
    };
  }

  private toResponse(activity: LeadActivity): LeadActivityResponse {
    return {
      id: activity.id,
      companyId: activity.companyId,
      leadId: activity.leadId,
      userId: activity.userId,
      type: activity.type,
      status: activity.status,
      title: activity.title,
      body: activity.body,
      scheduledAt: activity.scheduledAt,
      completedAt: activity.completedAt,
      createdAt: activity.createdAt,
      updatedAt: activity.updatedAt,
    };
  }
}
