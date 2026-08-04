import {
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import {
  FollowUpStatus,
  LeadActivityStatus,
  LeadStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/types/jwt-payload';
import { ExportQueryDto } from './dto/export.query.dto';
import { EXPORT_HARD_CAP, EXPORT_LIMIT_EXCEEDED } from './exports.constants';

type CompanyActor = AuthenticatedUser & { cid: string; sub: string };

type RequestMeta = {
  ip?: string;
  userAgent?: string;
};

export type CsvExportResult = {
  filename: string;
  csv: string;
  rowCount: number;
};

@Injectable()
export class ExportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  exportLeads(actor: CompanyActor, query: ExportQueryDto, meta?: RequestMeta) {
    return this.runExport({
      actor,
      query,
      meta,
      action: 'EXPORT_LEADS',
      filenamePrefix: 'leads',
      count: () =>
        this.prisma.lead.count({
          where: this.leadWhere(actor.cid, query),
        }),
      fetch: () =>
        this.prisma.lead.findMany({
          where: this.leadWhere(actor.cid, query),
          orderBy: { createdAt: 'asc' },
          take: EXPORT_HARD_CAP,
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
            status: true,
            source: true,
            ownerId: true,
            score: true,
            createdAt: true,
            updatedAt: true,
            convertedAt: true,
            firstResponseAt: true,
          },
        }),
      headers: [
        'id',
        'name',
        'phone',
        'email',
        'status',
        'source',
        'ownerId',
        'score',
        'createdAt',
        'updatedAt',
        'convertedAt',
        'firstResponseAt',
      ],
      row: (r) => [
        r.id,
        r.name,
        r.phone,
        r.email,
        r.status,
        r.source,
        r.ownerId,
        r.score,
        r.createdAt,
        r.updatedAt,
        r.convertedAt,
        r.firstResponseAt,
      ],
    });
  }

  exportActivities(
    actor: CompanyActor,
    query: ExportQueryDto,
    meta?: RequestMeta,
  ) {
    return this.runExport({
      actor,
      query,
      meta,
      action: 'EXPORT_ACTIVITIES',
      filenamePrefix: 'activities',
      count: () =>
        this.prisma.leadActivity.count({
          where: this.activityWhere(actor.cid, query),
        }),
      fetch: () =>
        this.prisma.leadActivity.findMany({
          where: this.activityWhere(actor.cid, query),
          orderBy: { createdAt: 'asc' },
          take: EXPORT_HARD_CAP,
          select: {
            id: true,
            leadId: true,
            type: true,
            status: true,
            title: true,
            userId: true,
            scheduledAt: true,
            completedAt: true,
            createdAt: true,
          },
        }),
      headers: [
        'id',
        'leadId',
        'type',
        'status',
        'title',
        'userId',
        'scheduledAt',
        'completedAt',
        'createdAt',
      ],
      row: (r) => [
        r.id,
        r.leadId,
        r.type,
        r.status,
        r.title,
        r.userId,
        r.scheduledAt,
        r.completedAt,
        r.createdAt,
      ],
    });
  }

  exportFollowUps(
    actor: CompanyActor,
    query: ExportQueryDto,
    meta?: RequestMeta,
  ) {
    return this.runExport({
      actor,
      query,
      meta,
      action: 'EXPORT_FOLLOWUPS',
      filenamePrefix: 'followups',
      count: () =>
        this.prisma.followUp.count({
          where: this.followUpWhere(actor.cid, query),
        }),
      fetch: () =>
        this.prisma.followUp.findMany({
          where: this.followUpWhere(actor.cid, query),
          orderBy: { createdAt: 'asc' },
          take: EXPORT_HARD_CAP,
          select: {
            id: true,
            leadId: true,
            status: true,
            type: true,
            channel: true,
            assignedUserId: true,
            scheduledAt: true,
            executedAt: true,
            createdAt: true,
          },
        }),
      headers: [
        'id',
        'leadId',
        'status',
        'type',
        'channel',
        'assignedUserId',
        'scheduledAt',
        'executedAt',
        'createdAt',
      ],
      row: (r) => [
        r.id,
        r.leadId,
        r.status,
        r.type,
        r.channel,
        r.assignedUserId,
        r.scheduledAt,
        r.executedAt,
        r.createdAt,
      ],
    });
  }

  private async runExport<T>(opts: {
    actor: CompanyActor;
    query: ExportQueryDto;
    meta?: RequestMeta;
    action: string;
    filenamePrefix: string;
    count: () => Promise<number>;
    fetch: () => Promise<T[]>;
    headers: string[];
    row: (item: T) => Array<string | number | Date | null | undefined>;
  }): Promise<CsvExportResult> {
    const total = await opts.count();
    if (total > EXPORT_HARD_CAP) {
      throw new HttpException(
        {
          statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
          code: EXPORT_LIMIT_EXCEEDED,
          message: `Export exceeds hard cap of ${EXPORT_HARD_CAP} records`,
          limit: EXPORT_HARD_CAP,
          total,
        },
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }

    const rows = await opts.fetch();
    const csv = this.toCsv(opts.headers, rows.map(opts.row));
    const date = new Date().toISOString().slice(0, 10);
    const filename = `${opts.filenamePrefix}-${opts.actor.cid.slice(0, 8)}-${date}.csv`;

    await this.prisma.$transaction(async (tx) => {
      await this.audit.write(tx, {
        companyId: opts.actor.cid,
        actorUserId: opts.actor.sub,
        action: opts.action,
        targetType: 'COMPANY',
        targetId: opts.actor.cid,
        before: null,
        after: {
          rowCount: rows.length,
          from: opts.query.from ?? null,
          to: opts.query.to ?? null,
          status: opts.query.status ?? null,
        },
        ip: opts.meta?.ip,
        userAgent: opts.meta?.userAgent,
      });
    });

    return { filename, csv, rowCount: rows.length };
  }

  private leadWhere(
    companyId: string,
    query: ExportQueryDto,
  ): Prisma.LeadWhereInput {
    const where: Prisma.LeadWhereInput = { companyId, deletedAt: null };
    if (query.status) where.status = query.status as LeadStatus;
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = query.from;
      if (query.to) where.createdAt.lte = query.to;
    }
    return where;
  }

  private activityWhere(
    companyId: string,
    query: ExportQueryDto,
  ): Prisma.LeadActivityWhereInput {
    const where: Prisma.LeadActivityWhereInput = { companyId, deletedAt: null };
    if (query.status) where.status = query.status as LeadActivityStatus;
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = query.from;
      if (query.to) where.createdAt.lte = query.to;
    }
    return where;
  }

  private followUpWhere(
    companyId: string,
    query: ExportQueryDto,
  ): Prisma.FollowUpWhereInput {
    const where: Prisma.FollowUpWhereInput = { companyId, deletedAt: null };
    if (query.status) where.status = query.status as FollowUpStatus;
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = query.from;
      if (query.to) where.createdAt.lte = query.to;
    }
    return where;
  }

  private toCsv(
    headers: string[],
    rows: Array<Array<string | number | Date | null | undefined>>,
  ): string {
    const lines = [
      headers.join(','),
      ...rows.map((cols) => cols.map((c) => this.escapeCsv(c)).join(',')),
    ];
    return `${lines.join('\n')}\n`;
  }

  private escapeCsv(value: string | number | Date | null | undefined): string {
    if (value === null || value === undefined) return '';
    const raw =
      value instanceof Date ? value.toISOString() : String(value);
    if (/[",\n\r]/.test(raw)) {
      return `"${raw.replace(/"/g, '""')}"`;
    }
    return raw;
  }
}
