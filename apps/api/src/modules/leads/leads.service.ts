import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Lead, LeadStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AiRecoveryService } from '../ai/ai-recovery.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/types/jwt-payload';
import { OutboundSuppressService } from '../outbound/outbound-suppress.service';
import { AssignLeadDto } from './dto/assign-lead.dto';
import { BulkAssignLeadsDto } from './dto/bulk-assign-leads.dto';
import { CreateLeadDto } from './dto/create-lead.dto';
import { ListLeadsQueryDto } from './dto/list-leads.query.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { normalizePhone } from './utils/normalize-phone';

type CompanyActor = AuthenticatedUser & { cid: string; sub: string };

type RequestMeta = {
  ip?: string;
  userAgent?: string;
};

export type LeadResponse = {
  id: string;
  companyId: string;
  name: string | null;
  phone: string;
  email: string | null;
  source: string;
  status: LeadStatus;
  score: number;
  ownerId: string | null;
  externalId: string | null;
  convertedAt: Date | null;
  firstResponseAt: Date | null;
  lastContactAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type BulkAssignResult = {
  ownerId: string | null;
  requested: number;
  updated: number;
  ignored: number;
  ignoredIds: string[];
};

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly aiRecovery?: AiRecoveryService,
    @Optional() private readonly outboundSuppress?: OutboundSuppressService,
  ) {}

  async create(actor: CompanyActor, dto: CreateLeadDto, meta?: RequestMeta) {
    const companyId = actor.cid;
    const phone = normalizePhone(dto.phone);
    const ownerId =
      dto.ownerId === undefined ? null : dto.ownerId === null ? null : dto.ownerId;

    if (ownerId) {
      await this.assertActiveMember(companyId, ownerId);
    }

    const status = dto.status ?? LeadStatus.NEW;
    const data: Prisma.LeadCreateInput = {
      company: { connect: { id: companyId } },
      name: dto.name.trim(),
      phone,
      email: dto.email?.toLowerCase() ?? null,
      source: dto.source ?? 'WHATSAPP',
      status,
      score: dto.score ?? 0,
      externalId: dto.externalId,
      ...(ownerId ? { owner: { connect: { id: ownerId } } } : {}),
      ...(status === LeadStatus.CONVERTED ? { convertedAt: new Date() } : {}),
    };

    try {
      return await this.prisma.$transaction(async (tx) => {
        const lead = await tx.lead.create({ data });
        await tx.leadStatusTransition.create({
          data: {
            companyId,
            leadId: lead.id,
            fromStatus: null,
            toStatus: lead.status,
            changedByUserId: actor.sub,
          },
        });
        await this.audit.write(tx, {
          companyId,
          actorUserId: actor.sub,
          action: 'LEAD_CREATE',
          targetType: 'LEAD',
          targetId: lead.id,
          before: null,
          after: this.snapshot(lead),
          ip: meta?.ip,
          userAgent: meta?.userAgent,
        });
        return this.toResponse(lead);
      });
    } catch (error) {
      this.rethrowUniquePhone(error);
      throw error;
    }
  }

  async list(actor: CompanyActor, query: ListLeadsQueryDto) {
    if (query.unassigned === true && query.ownerId) {
      throw new BadRequestException('Cannot combine unassigned=true with ownerId');
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = this.buildListWhere(actor.cid, query);

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.lead.count({ where }),
      this.prisma.lead.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      data: rows.map((row) => this.toResponse(row)),
      meta: {
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    };
  }

  async findOne(actor: CompanyActor, id: string) {
    const lead = await this.findActiveInCompany(actor.cid, id);
    return this.toResponse(lead);
  }

  async update(
    actor: CompanyActor,
    id: string,
    dto: UpdateLeadDto,
    meta?: RequestMeta,
  ) {
    const companyId = actor.cid;
    const existing = await this.findActiveInCompany(companyId, id);

    if (dto.ownerId) {
      await this.assertActiveMember(companyId, dto.ownerId);
    }

    const data: Prisma.LeadUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.phone !== undefined) data.phone = normalizePhone(dto.phone);
    if (dto.email !== undefined) {
      data.email = dto.email === null ? null : dto.email.toLowerCase();
    }
    if (dto.source !== undefined) data.source = dto.source;
    if (dto.score !== undefined) data.score = dto.score;
    if (dto.externalId !== undefined) data.externalId = dto.externalId;
    if (dto.ownerId !== undefined) {
      data.owner =
        dto.ownerId === null
          ? { disconnect: true }
          : { connect: { id: dto.ownerId } };
    }
    const statusChanged =
      dto.status !== undefined && dto.status !== existing.status;
    if (dto.status !== undefined) {
      data.status = dto.status;
      if (dto.status === LeadStatus.CONVERTED && !existing.convertedAt) {
        data.convertedAt = new Date();
      }
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const lead = await tx.lead.update({
          where: { id: existing.id },
          data,
        });
        await this.audit.write(tx, {
          companyId,
          actorUserId: actor.sub,
          action: 'LEAD_UPDATE',
          targetType: 'LEAD',
          targetId: lead.id,
          before: this.snapshot(existing),
          after: this.snapshot(lead),
          ip: meta?.ip,
          userAgent: meta?.userAgent,
        });
        if (statusChanged) {
          await tx.leadStatusTransition.create({
            data: {
              companyId,
              leadId: lead.id,
              fromStatus: existing.status,
              toStatus: lead.status,
              changedByUserId: actor.sub,
            },
          });
          await this.audit.write(tx, {
            companyId,
            actorUserId: actor.sub,
            action: 'LEAD_STATUS_CHANGE',
            targetType: 'LEAD',
            targetId: lead.id,
            before: { status: existing.status },
            after: { status: lead.status },
            ip: meta?.ip,
            userAgent: meta?.userAgent,
          });
        }
        return this.toResponse(lead);
      }).then((lead) => {
        if (
          statusChanged &&
          this.aiRecovery &&
          (lead.status === LeadStatus.CONVERTED ||
            lead.status === LeadStatus.LOST)
        ) {
          void this.aiRecovery
            .stopOnLeadTerminal({
              companyId,
              leadId: lead.id,
              status: lead.status,
            })
            .catch((err) => {
              this.logger.warn(
                `ai recovery stop-on-terminal failed lead=${lead.id}: ${
                  err instanceof Error ? err.message : String(err)
                }`,
              );
            });
        }
        if (
          statusChanged &&
          lead.status === LeadStatus.LOST &&
          this.outboundSuppress
        ) {
          void this.outboundSuppress
            .maybeSuppressOnLost({
              companyId,
              leadId: lead.id,
              phone: lead.phone,
              status: lead.status,
            })
            .catch((err) => {
              this.logger.warn(
                `outbound suppress-on-lost failed lead=${lead.id}: ${
                  err instanceof Error ? err.message : String(err)
                }`,
              );
            });
        }
        return lead;
      });
    } catch (error) {
      this.rethrowUniquePhone(error);
      throw error;
    }
  }

  async assign(
    actor: CompanyActor,
    id: string,
    dto: AssignLeadDto,
    meta?: RequestMeta,
  ) {
    const companyId = actor.cid;
    const existing = await this.findActiveInCompany(companyId, id);
    await this.assertActiveMember(companyId, dto.ownerId);

    return this.prisma.$transaction(async (tx) => {
      const lead = await tx.lead.update({
        where: { id: existing.id },
        data: { owner: { connect: { id: dto.ownerId } } },
      });
      await this.audit.write(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'LEAD_ASSIGN',
        targetType: 'LEAD',
        targetId: lead.id,
        before: this.snapshot(existing),
        after: this.snapshot(lead),
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      });
      return this.toResponse(lead);
    });
  }

  async unassign(actor: CompanyActor, id: string, meta?: RequestMeta) {
    const companyId = actor.cid;
    const existing = await this.findActiveInCompany(companyId, id);

    return this.prisma.$transaction(async (tx) => {
      const lead = await tx.lead.update({
        where: { id: existing.id },
        data: { owner: { disconnect: true } },
      });
      await this.audit.write(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'LEAD_UNASSIGN',
        targetType: 'LEAD',
        targetId: lead.id,
        before: this.snapshot(existing),
        after: this.snapshot(lead),
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      });
      return this.toResponse(lead);
    });
  }

  async bulkAssign(
    actor: CompanyActor,
    dto: BulkAssignLeadsDto,
    meta?: RequestMeta,
  ): Promise<BulkAssignResult> {
    const companyId = actor.cid;
    const ownerId = dto.ownerId ?? null;
    const requestedIds = [...new Set(dto.leadIds)];

    if (ownerId) {
      await this.assertActiveMember(companyId, ownerId);
    }

    const matching = await this.prisma.lead.findMany({
      where: {
        companyId,
        deletedAt: null,
        id: { in: requestedIds },
      },
    });
    const matchingIds = new Set(matching.map((l) => l.id));
    const ignoredIds = requestedIds.filter((id) => !matchingIds.has(id));
    const updatedIds: string[] = [];

    await this.prisma.$transaction(async (tx) => {
      for (const existing of matching) {
        const lead = await tx.lead.update({
          where: { id: existing.id },
          data:
            ownerId === null
              ? { owner: { disconnect: true } }
              : { owner: { connect: { id: ownerId } } },
        });
        updatedIds.push(lead.id);
        await this.audit.write(tx, {
          companyId,
          actorUserId: actor.sub,
          action: ownerId === null ? 'LEAD_UNASSIGN' : 'LEAD_ASSIGN',
          targetType: 'LEAD',
          targetId: lead.id,
          before: this.snapshot(existing),
          after: this.snapshot(lead),
          ip: meta?.ip,
          userAgent: meta?.userAgent,
        });
      }

      await this.audit.write(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'LEAD_BULK_ASSIGN',
        targetType: 'LEAD',
        targetId: updatedIds[0] ?? requestedIds[0],
        before: null,
        after: {
          ownerId,
          leadIds: updatedIds,
          requested: requestedIds.length,
          ignored: ignoredIds.length,
          ignoredIds,
        },
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      });
    });

    return {
      ownerId,
      requested: requestedIds.length,
      updated: updatedIds.length,
      ignored: ignoredIds.length,
      ignoredIds,
    };
  }

  async remove(actor: CompanyActor, id: string, meta?: RequestMeta) {
    const companyId = actor.cid;
    const existing = await this.findActiveInCompany(companyId, id);
    const deletedAt = new Date();

    await this.prisma.$transaction(async (tx) => {
      const lead = await tx.lead.update({
        where: { id: existing.id },
        data: { deletedAt },
      });
      await this.audit.write(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'LEAD_DELETE',
        targetType: 'LEAD',
        targetId: lead.id,
        before: this.snapshot(existing),
        after: this.snapshot(lead),
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      });
    });
  }

  private buildListWhere(
    companyId: string,
    query: ListLeadsQueryDto,
  ): Prisma.LeadWhereInput {
    const where: Prisma.LeadWhereInput = {
      companyId,
      deletedAt: null,
    };

    if (query.status) where.status = query.status;

    if (query.unassigned === true) {
      where.ownerId = null;
    } else if (query.ownerId) {
      where.ownerId = query.ownerId;
    }

    if (query.search?.trim()) {
      const term = query.search.trim();
      const digits = normalizePhone(term);
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        ...(digits
          ? [{ phone: { contains: digits, mode: 'insensitive' as const } }]
          : [{ phone: { contains: term, mode: 'insensitive' as const } }]),
      ];
    }

    return where;
  }

  private async findActiveInCompany(companyId: string, id: string): Promise<Lead> {
    const lead = await this.prisma.lead.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!lead) {
      throw new NotFoundException('Lead not found');
    }
    return lead;
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
      throw new BadRequestException('ownerId must be an active member of this company');
    }
  }

  private snapshot(lead: Lead): Prisma.InputJsonValue {
    return {
      id: lead.id,
      companyId: lead.companyId,
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      source: lead.source,
      status: lead.status,
      score: lead.score,
      ownerId: lead.ownerId,
      externalId: lead.externalId,
      convertedAt: lead.convertedAt?.toISOString() ?? null,
      deletedAt: lead.deletedAt?.toISOString() ?? null,
    };
  }

  private toResponse(lead: Lead): LeadResponse {
    return {
      id: lead.id,
      companyId: lead.companyId,
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      source: lead.source,
      status: lead.status,
      score: lead.score,
      ownerId: lead.ownerId,
      externalId: lead.externalId,
      convertedAt: lead.convertedAt,
      firstResponseAt: lead.firstResponseAt,
      lastContactAt: lead.lastContactAt,
      createdAt: lead.createdAt,
      updatedAt: lead.updatedAt,
    };
  }

  private rethrowUniquePhone(error: unknown): void {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('Lead with this phone already exists');
    }
  }
}
