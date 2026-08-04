import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LeadNote, MembershipRole, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/types/jwt-payload';
import { CreateLeadNoteDto } from './dto/create-lead-note.dto';
import { UpdateLeadNoteDto } from './dto/update-lead-note.dto';

type CompanyActor = AuthenticatedUser & {
  cid: string;
  sub: string;
  role: MembershipRole;
};

type RequestMeta = {
  ip?: string;
  userAgent?: string;
};

export type LeadNoteResponse = {
  id: string;
  companyId: string;
  leadId: string;
  userId: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class LeadNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(
    actor: CompanyActor,
    leadId: string,
    dto: CreateLeadNoteDto,
    meta?: RequestMeta,
  ) {
    const companyId = actor.cid;
    await this.assertLeadInCompany(companyId, leadId);

    return this.prisma.$transaction(async (tx) => {
      const note = await tx.leadNote.create({
        data: {
          companyId,
          leadId,
          userId: actor.sub,
          body: dto.body,
        },
      });
      await this.audit.write(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'NOTE_CREATE',
        targetType: 'LEAD_NOTE',
        targetId: note.id,
        before: null,
        after: this.snapshot(note),
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      });
      return this.toResponse(note);
    });
  }

  async list(actor: CompanyActor, leadId: string) {
    const companyId = actor.cid;
    await this.assertLeadInCompany(companyId, leadId);

    const rows = await this.prisma.leadNote.findMany({
      where: { companyId, leadId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => this.toResponse(row));
  }

  async findOne(actor: CompanyActor, leadId: string, id: string) {
    const note = await this.findActive(actor.cid, leadId, id);
    return this.toResponse(note);
  }

  async update(
    actor: CompanyActor,
    leadId: string,
    id: string,
    dto: UpdateLeadNoteDto,
    meta?: RequestMeta,
  ) {
    const companyId = actor.cid;
    const existing = await this.findActive(companyId, leadId, id);
    this.assertCanMutate(actor, existing.userId);

    return this.prisma.$transaction(async (tx) => {
      const note = await tx.leadNote.update({
        where: { id: existing.id },
        data: { body: dto.body },
      });
      await this.audit.write(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'NOTE_UPDATE',
        targetType: 'LEAD_NOTE',
        targetId: note.id,
        before: this.snapshot(existing),
        after: this.snapshot(note),
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      });
      return this.toResponse(note);
    });
  }

  async remove(
    actor: CompanyActor,
    leadId: string,
    id: string,
    meta?: RequestMeta,
  ): Promise<void> {
    const companyId = actor.cid;
    const existing = await this.findActive(companyId, leadId, id);
    this.assertCanMutate(actor, existing.userId);
    const deletedAt = new Date();

    await this.prisma.$transaction(async (tx) => {
      const note = await tx.leadNote.update({
        where: { id: existing.id },
        data: { deletedAt },
      });
      await this.audit.write(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'NOTE_DELETE',
        targetType: 'LEAD_NOTE',
        targetId: note.id,
        before: this.snapshot(existing),
        after: this.snapshot(note),
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      });
    });
  }

  private assertCanMutate(actor: CompanyActor, authorUserId: string) {
    const isAuthor = actor.sub === authorUserId;
    const isElevated =
      actor.role === MembershipRole.OWNER || actor.role === MembershipRole.ADMIN;
    if (!isAuthor && !isElevated) {
      throw new ForbiddenException('Only author or OWNER/ADMIN can modify note');
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
  ): Promise<LeadNote> {
    await this.assertLeadInCompany(companyId, leadId);
    const note = await this.prisma.leadNote.findFirst({
      where: { id, companyId, leadId, deletedAt: null },
    });
    if (!note) {
      throw new NotFoundException('Note not found');
    }
    return note;
  }

  private snapshot(note: LeadNote): Prisma.InputJsonValue {
    return {
      id: note.id,
      companyId: note.companyId,
      leadId: note.leadId,
      userId: note.userId,
      body: note.body.slice(0, 2000),
      deletedAt: note.deletedAt?.toISOString() ?? null,
    };
  }

  private toResponse(note: LeadNote): LeadNoteResponse {
    return {
      id: note.id,
      companyId: note.companyId,
      leadId: note.leadId,
      userId: note.userId,
      body: note.body,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    };
  }
}
