import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { LeadStatus, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PrometheusMetricsService } from '../../observability/prometheus-metrics.service';
import {
  OUTBOUND_IMPORT_COMMITTED,
  OUTBOUND_IMPORT_CREATED,
  OUTBOUND_IMPORT_CANCELLED,
  OUTBOUND_IMPORT_DEFAULT_SOURCE,
  OUTBOUND_IMPORT_DEDUPE_MODES,
  OUTBOUND_IMPORT_FAILED,
  OUTBOUND_IMPORT_KINDS,
  OUTBOUND_IMPORT_MAPPING_UPDATED,
  OUTBOUND_IMPORT_MAX_BYTES,
  OUTBOUND_IMPORT_MAX_ROWS,
  OUTBOUND_IMPORT_METADATA_FIELDS,
  OUTBOUND_IMPORT_PREVIEW_ROWS,
  OUTBOUND_IMPORT_STATUSES,
  OUTBOUND_IMPORT_VALIDATED,
  type OutboundImportKind,
} from './outbound-import.constants';
import { PasteImportDto, UpdateImportMappingDto } from './dto/paste-import.dto';
import { OutboundSuppressService } from './outbound-suppress.service';
import { normalizeImportPhone } from './utils/normalize-import-phone';
import {
  guessColumnMapping,
  parseCsvBuffer,
  parsePasteTable,
  parseXlsxBuffer,
  type TabularParseResult,
} from './utils/parse-tabular';

type Actor = { cid: string; sub: string };
type ReqMeta = { ip?: string; userAgent?: string };

type ColumnMapping = {
  phone?: string | null;
  name?: string | null;
  email?: string | null;
  externalId?: string | null;
  source?: string | null;
  city?: string | null;
  product?: string | null;
  value?: string | null;
  notes?: string | null;
};

type RowError = {
  row: number;
  phone?: string;
  code: string;
  message: string;
};

type ImportReport = {
  total: number;
  valid: number;
  invalid: number;
  duplicates: number;
  suppressed: number;
  ignored: number;
  created: number;
  errors: RowError[];
};

type PreparedRow = {
  rowNumber: number;
  phone: string;
  name: string | null;
  email: string | null;
  externalId: string | null;
  source: string;
  metadata: Record<string, string>;
};

@Injectable()
export class OutboundImportService {
  private readonly logger = new Logger(OutboundImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly suppress: OutboundSuppressService,
    @Optional() private readonly prom?: PrometheusMetricsService,
  ) {}

  async createFromUpload(
    actor: Actor,
    file: Express.Multer.File,
    sourceDefault?: string,
    meta?: ReqMeta,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('file is required');
    }
    if (file.size > OUTBOUND_IMPORT_MAX_BYTES) {
      throw new BadRequestException(
        `file exceeds max size of ${OUTBOUND_IMPORT_MAX_BYTES} bytes`,
      );
    }

    const kind = detectKind(file);
    let parsed: TabularParseResult;
    try {
      parsed =
        kind === OUTBOUND_IMPORT_KINDS.XLSX
          ? await parseXlsxBuffer(file.buffer)
          : parseCsvBuffer(file.buffer);
    } catch (err) {
      throw this.mapParseError(err);
    }

    return this.persistBatch({
      actor,
      kind,
      parsed,
      filename: file.originalname?.slice(0, 255) || 'upload',
      contentType: file.mimetype?.slice(0, 120) || null,
      byteSize: file.size,
      fileHash: sha256(file.buffer),
      sourceDefault,
      meta,
    });
  }

  async createFromPaste(actor: Actor, dto: PasteImportDto, meta?: ReqMeta) {
    let parsed: TabularParseResult;
    try {
      parsed = parsePasteTable({
        headers: dto.headers,
        rows: dto.rows ?? [],
        text: dto.text,
      });
    } catch (err) {
      throw this.mapParseError(err);
    }

    return this.persistBatch({
      actor,
      kind: OUTBOUND_IMPORT_KINDS.PASTE,
      parsed,
      filename: 'paste.tsv',
      contentType: 'text/tab-separated-values',
      byteSize: Buffer.byteLength(
        dto.text ?? JSON.stringify(dto.rows ?? []),
        'utf8',
      ),
      fileHash: sha256(
        Buffer.from(
          dto.text ?? JSON.stringify({ headers: dto.headers, rows: dto.rows }),
        ),
      ),
      sourceDefault: dto.sourceDefault,
      meta,
    });
  }

  async list(actor: Actor, page = 1, pageSize = 20) {
    const where = { companyId: actor.cid, deletedAt: null };
    const [total, rows] = await Promise.all([
      this.prisma.leadImportBatch.count({ where }),
      this.prisma.leadImportBatch.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      items: rows.map((r) => this.serialize(r, { includeStaged: false })),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async get(actor: Actor, id: string) {
    const row = await this.requireBatch(actor.cid, id);
    return this.serialize(row, { includeStaged: false });
  }

  async updateMapping(
    actor: Actor,
    id: string,
    dto: UpdateImportMappingDto,
    meta?: ReqMeta,
  ) {
    const batch = await this.requireBatch(actor.cid, id);
    this.assertMutable(batch.status);

    const mapping = normalizeMapping(dto.columnMapping);
    if (!mapping.phone) {
      throw new BadRequestException('columnMapping.phone is required');
    }
    const headers = asStringArray(batch.columnHeaders);
    if (!headers.includes(mapping.phone)) {
      throw new BadRequestException(
        `phone header "${mapping.phone}" not in columnHeaders`,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.leadImportBatch.update({
        where: { id },
        data: {
          status: OUTBOUND_IMPORT_STATUSES.MAPPING,
          columnMapping: mapping,
          sourceDefault:
            dto.sourceDefault?.trim().slice(0, 32) || batch.sourceDefault,
          dedupeMode:
            dto.dedupeMode === OUTBOUND_IMPORT_DEDUPE_MODES.REJECT
              ? OUTBOUND_IMPORT_DEDUPE_MODES.REJECT
              : OUTBOUND_IMPORT_DEDUPE_MODES.SKIP,
          report: Prisma.DbNull,
        },
      });
      await this.audit.write(tx, {
        companyId: actor.cid,
        actorUserId: actor.sub,
        action: OUTBOUND_IMPORT_MAPPING_UPDATED,
        targetType: 'LEAD_IMPORT_BATCH',
        targetId: row.id,
        before: { status: batch.status, columnMapping: batch.columnMapping },
        after: {
          status: row.status,
          columnMapping: row.columnMapping,
          sourceDefault: row.sourceDefault,
          dedupeMode: row.dedupeMode,
        },
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      });
      return row;
    });

    return this.serialize(updated, { includeStaged: false });
  }

  async validate(actor: Actor, id: string, meta?: ReqMeta) {
    const batch = await this.requireBatch(actor.cid, id);
    this.assertMutable(batch.status);
    const mapping = (batch.columnMapping ?? null) as ColumnMapping | null;
    if (!mapping?.phone) {
      throw new BadRequestException('Set column mapping before validate');
    }

    const prepared = await this.prepareRows(actor.cid, batch, mapping);
    const report = prepared.report;

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.leadImportBatch.update({
        where: { id },
        data: {
          status: OUTBOUND_IMPORT_STATUSES.VALIDATED,
          report: report,
          errorMessage: null,
        },
      });
      await this.audit.write(tx, {
        companyId: actor.cid,
        actorUserId: actor.sub,
        action: OUTBOUND_IMPORT_VALIDATED,
        targetType: 'LEAD_IMPORT_BATCH',
        targetId: row.id,
        before: { status: batch.status },
        after: {
          status: row.status,
          valid: report.valid,
          invalid: report.invalid,
          duplicates: report.duplicates,
          suppressed: report.suppressed,
        },
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      });
      return row;
    });

    this.prom?.recordOutboundImportValidated(report.valid, report.invalid);
    return this.serialize(updated, { includeStaged: false });
  }

  async commit(actor: Actor, id: string, meta?: ReqMeta) {
    const batch = await this.requireBatch(actor.cid, id);
    if (batch.status !== OUTBOUND_IMPORT_STATUSES.VALIDATED) {
      throw new ConflictException(
        'Batch must be VALIDATED before commit (run validate first)',
      );
    }

    const mapping = (batch.columnMapping ?? null) as ColumnMapping | null;
    if (!mapping?.phone) {
      throw new BadRequestException('columnMapping.phone is required');
    }

    await this.prisma.leadImportBatch.update({
      where: { id },
      data: { status: OUTBOUND_IMPORT_STATUSES.COMMITTING },
    });

    try {
      const prepared = await this.prepareRows(actor.cid, batch, mapping);
      let created = 0;
      const createdIds: string[] = [];

      for (const row of prepared.rows) {
        try {
          const lead = await this.prisma.$transaction(async (tx) => {
            const leadRow = await tx.lead.create({
              data: {
                companyId: actor.cid,
                name: row.name,
                phone: row.phone,
                email: row.email,
                source: row.source.slice(0, 32),
                status: LeadStatus.NEW,
                externalId: row.externalId,
                metadata: {
                  ...row.metadata,
                  importBatchId: batch.id,
                  importRow: row.rowNumber,
                },
              },
            });
            await tx.leadStatusTransition.create({
              data: {
                companyId: actor.cid,
                leadId: leadRow.id,
                fromStatus: null,
                toStatus: LeadStatus.NEW,
                changedByUserId: actor.sub,
              },
            });
            return leadRow;
          });
          created += 1;
          createdIds.push(lead.id);
        } catch (err) {
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === 'P2002'
          ) {
            prepared.report.duplicates += 1;
            prepared.report.valid = Math.max(0, prepared.report.valid - 1);
            prepared.report.errors.push({
              row: row.rowNumber,
              phone: row.phone,
              code: 'DUPLICATE_RACE',
              message: 'Phone already exists (race)',
            });
            continue;
          }
          throw err;
        }
      }

      prepared.report.created = created;
      prepared.report.ignored =
        prepared.report.duplicates +
        prepared.report.suppressed +
        prepared.report.invalid;

      const updated = await this.prisma.$transaction(async (tx) => {
        const row = await tx.leadImportBatch.update({
          where: { id },
          data: {
            status: OUTBOUND_IMPORT_STATUSES.COMPLETED,
            report: prepared.report,
            committedAt: new Date(),
            errorMessage: null,
          },
        });
        await this.audit.write(tx, {
          companyId: actor.cid,
          actorUserId: actor.sub,
          action: OUTBOUND_IMPORT_COMMITTED,
          targetType: 'LEAD_IMPORT_BATCH',
          targetId: row.id,
          before: { status: OUTBOUND_IMPORT_STATUSES.COMMITTING },
          after: {
            status: row.status,
            created,
            createdIds: createdIds.slice(0, 50),
            valid: prepared.report.valid,
            invalid: prepared.report.invalid,
            duplicates: prepared.report.duplicates,
            suppressed: prepared.report.suppressed,
          },
          ip: meta?.ip,
          userAgent: meta?.userAgent,
        });
        return row;
      });

      this.prom?.recordOutboundImportCommitted(created);
      this.prom?.recordOutboundImportSkipped(
        prepared.report.duplicates + prepared.report.suppressed,
      );
      return this.serialize(updated, { includeStaged: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.prisma.leadImportBatch.update({
        where: { id },
        data: {
          status: OUTBOUND_IMPORT_STATUSES.FAILED,
          errorMessage: message.slice(0, 1000),
        },
      });
      await this.prisma.$transaction(async (tx) => {
        await this.audit.write(tx, {
          companyId: actor.cid,
          actorUserId: actor.sub,
          action: OUTBOUND_IMPORT_FAILED,
          targetType: 'LEAD_IMPORT_BATCH',
          targetId: id,
          before: null,
          after: { error: message.slice(0, 500) },
          ip: meta?.ip,
          userAgent: meta?.userAgent,
        });
      });
      this.prom?.recordOutboundImportFailed();
      this.logger.error(`import commit failed batch=${id}: ${message}`);
      throw err;
    }
  }

  async cancel(actor: Actor, id: string, meta?: ReqMeta) {
    const batch = await this.requireBatch(actor.cid, id);
    if (
      batch.status === OUTBOUND_IMPORT_STATUSES.COMPLETED ||
      batch.status === OUTBOUND_IMPORT_STATUSES.COMMITTING
    ) {
      throw new ConflictException('Cannot cancel a completed/committing batch');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.leadImportBatch.update({
        where: { id },
        data: { status: OUTBOUND_IMPORT_STATUSES.CANCELLED },
      });
      await this.audit.write(tx, {
        companyId: actor.cid,
        actorUserId: actor.sub,
        action: OUTBOUND_IMPORT_CANCELLED,
        targetType: 'LEAD_IMPORT_BATCH',
        targetId: row.id,
        before: { status: batch.status },
        after: { status: row.status },
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      });
      return row;
    });
    return this.serialize(updated, { includeStaged: false });
  }

  async dashboard(actor: Actor) {
    const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const batches = await this.prisma.leadImportBatch.findMany({
      where: {
        companyId: actor.cid,
        deletedAt: null,
        createdAt: { gte: weekStart },
      },
      select: { status: true, report: true, rowCount: true },
    });

    let imported = 0;
    let valid = 0;
    let invalid = 0;
    let duplicates = 0;
    let ignored = 0;
    let suppressed = 0;
    let created = 0;

    for (const b of batches) {
      imported += b.rowCount;
      const r = b.report as ImportReport | null;
      if (!r) continue;
      valid += r.valid ?? 0;
      invalid += r.invalid ?? 0;
      duplicates += r.duplicates ?? 0;
      suppressed += r.suppressed ?? 0;
      ignored += r.ignored ?? 0;
      created += r.created ?? 0;
    }

    return {
      companyId: actor.cid,
      generatedAt: new Date().toISOString(),
      windowDays: 7,
      metrics: {
        batches: batches.length,
        imported,
        valid,
        invalid,
        duplicates,
        suppressed,
        ignored,
        created,
        completedBatches: batches.filter(
          (b) => b.status === OUTBOUND_IMPORT_STATUSES.COMPLETED,
        ).length,
      },
    };
  }

  private async persistBatch(input: {
    actor: Actor;
    kind: OutboundImportKind;
    parsed: TabularParseResult;
    filename: string | null;
    contentType: string | null;
    byteSize: number | null;
    fileHash: string | null;
    sourceDefault?: string;
    meta?: ReqMeta;
  }) {
    if (input.parsed.rows.length === 0) {
      throw new BadRequestException('No data rows found');
    }
    if (input.parsed.rows.length > OUTBOUND_IMPORT_MAX_ROWS) {
      throw new BadRequestException(
        `Max ${OUTBOUND_IMPORT_MAX_ROWS} rows per batch`,
      );
    }

    const guessed = guessColumnMapping(input.parsed.headers);
    const preview = input.parsed.rows
      .slice(0, OUTBOUND_IMPORT_PREVIEW_ROWS)
      .map((cells) => {
        const obj: Record<string, string> = {};
        input.parsed.headers.forEach((h, i) => {
          obj[h] = cells[i] ?? '';
        });
        return obj;
      });

    const stagedData = {
      headers: input.parsed.headers,
      rows: input.parsed.rows,
    };

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.leadImportBatch.create({
        data: {
          companyId: input.actor.cid,
          createdByUserId: input.actor.sub,
          status: OUTBOUND_IMPORT_STATUSES.UPLOADED,
          inputKind: input.kind,
          filename: input.filename,
          contentType: input.contentType,
          fileHash: input.fileHash,
          byteSize: input.byteSize,
          rowCount: input.parsed.rows.length,
          columnHeaders: input.parsed.headers,
          columnMapping: Object.keys(guessed).length ? guessed : undefined,
          sourceDefault:
            input.sourceDefault?.trim().slice(0, 32) ||
            OUTBOUND_IMPORT_DEFAULT_SOURCE,
          dedupeMode: OUTBOUND_IMPORT_DEDUPE_MODES.SKIP,
          stagedData: stagedData,
          previewSample: preview,
        },
      });
      await this.audit.write(tx, {
        companyId: input.actor.cid,
        actorUserId: input.actor.sub,
        action: OUTBOUND_IMPORT_CREATED,
        targetType: 'LEAD_IMPORT_BATCH',
        targetId: row.id,
        before: null,
        after: {
          inputKind: row.inputKind,
          rowCount: row.rowCount,
          filename: row.filename,
          guessedMapping: guessed,
        },
        ip: input.meta?.ip,
        userAgent: input.meta?.userAgent,
      });
      return row;
    });

    this.prom?.recordOutboundImportUploaded(input.parsed.rows.length);
    return this.serialize(created, { includeStaged: false });
  }

  private async prepareRows(
    companyId: string,
    batch: {
      id: string;
      stagedData: unknown;
      columnHeaders: unknown;
      sourceDefault: string;
      dedupeMode: string;
    },
    mapping: ColumnMapping,
  ): Promise<{ rows: PreparedRow[]; report: ImportReport }> {
    const staged = batch.stagedData as { headers: string[]; rows: string[][] };
    const headers = staged.headers;
    const headerIndex = new Map(headers.map((h, i) => [h, i]));

    const get = (cells: string[], header: string | null | undefined) => {
      if (!header) return '';
      const idx = headerIndex.get(header);
      if (idx == null) return '';
      return (cells[idx] ?? '').trim();
    };

    const report: ImportReport = {
      total: staged.rows.length,
      valid: 0,
      invalid: 0,
      duplicates: 0,
      suppressed: 0,
      ignored: 0,
      created: 0,
      errors: [],
    };

    const prepared: PreparedRow[] = [];
    const seenInFile = new Set<string>();

    for (let i = 0; i < staged.rows.length; i += 1) {
      const rowNumber = i + 2; // 1-based + header
      const cells = staged.rows[i];
      const phoneRaw = get(cells, mapping.phone);
      const phoneResult = normalizeImportPhone(phoneRaw);
      if (!phoneResult.ok) {
        report.invalid += 1;
        report.errors.push({
          row: rowNumber,
          phone: phoneRaw || undefined,
          code: phoneResult.reason,
          message: phoneResult.reason,
        });
        continue;
      }

      if (seenInFile.has(phoneResult.phone)) {
        report.duplicates += 1;
        report.errors.push({
          row: rowNumber,
          phone: phoneResult.phone,
          code: 'DUPLICATE_IN_FILE',
          message: 'Duplicate phone in file',
        });
        if (batch.dedupeMode === OUTBOUND_IMPORT_DEDUPE_MODES.REJECT) {
          report.invalid += 1;
        }
        continue;
      }
      seenInFile.add(phoneResult.phone);

      const existing = await this.prisma.lead.findFirst({
        where: {
          companyId,
          phone: phoneResult.phone,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (existing) {
        report.duplicates += 1;
        report.errors.push({
          row: rowNumber,
          phone: phoneResult.phone,
          code: 'DUPLICATE_IN_DB',
          message: 'Phone already exists for company',
        });
        if (batch.dedupeMode === OUTBOUND_IMPORT_DEDUPE_MODES.REJECT) {
          report.invalid += 1;
        }
        continue;
      }

      if (await this.suppress.isSuppressed(companyId, phoneResult.phone)) {
        report.suppressed += 1;
        report.errors.push({
          row: rowNumber,
          phone: phoneResult.phone,
          code: 'SUPPRESSED',
          message: 'Phone is on suppress / opt-out list',
        });
        continue;
      }

      const emailRaw = get(cells, mapping.email);
      const email =
        emailRaw && emailRaw.includes('@')
          ? emailRaw.toLowerCase().slice(0, 320)
          : null;
      if (emailRaw && !email) {
        report.invalid += 1;
        report.errors.push({
          row: rowNumber,
          phone: phoneResult.phone,
          code: 'EMAIL_INVALID',
          message: 'Invalid email',
        });
        continue;
      }

      const nameRaw = get(cells, mapping.name);
      const sourceRaw = get(cells, mapping.source);
      const metadata: Record<string, string> = {};
      for (const field of OUTBOUND_IMPORT_METADATA_FIELDS) {
        const header = mapping[field];
        const val = get(cells, header);
        if (val) metadata[field] = val.slice(0, 500);
      }

      prepared.push({
        rowNumber,
        phone: phoneResult.phone,
        name: nameRaw ? nameRaw.slice(0, 200) : null,
        email,
        externalId: get(cells, mapping.externalId).slice(0, 191) || null,
        source: (
          sourceRaw ||
          batch.sourceDefault ||
          OUTBOUND_IMPORT_DEFAULT_SOURCE
        ).slice(0, 32),
        metadata,
      });
      report.valid += 1;
    }

    report.ignored = report.duplicates + report.suppressed + report.invalid;
    // Cap errors in report for payload size
    report.errors = report.errors.slice(0, 200);
    return { rows: prepared, report };
  }

  private async requireBatch(companyId: string, id: string) {
    const row = await this.prisma.leadImportBatch.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Import batch not found');
    return row;
  }

  private assertMutable(status: string) {
    if (
      status === OUTBOUND_IMPORT_STATUSES.COMPLETED ||
      status === OUTBOUND_IMPORT_STATUSES.COMMITTING ||
      status === OUTBOUND_IMPORT_STATUSES.CANCELLED
    ) {
      throw new ConflictException(`Batch status ${status} is not mutable`);
    }
  }

  private mapParseError(err: unknown): BadRequestException {
    const code = err instanceof Error ? err.message : String(err);
    const map: Record<string, string> = {
      TABULAR_EMPTY: 'File/table is empty',
      TABULAR_TOO_MANY_ROWS: `Max ${OUTBOUND_IMPORT_MAX_ROWS} rows per batch`,
      XLSX_EMPTY: 'XLSX workbook has no sheets',
    };
    return new BadRequestException(map[code] || `Parse failed: ${code}`);
  }

  serialize(
    row: {
      id: string;
      companyId: string;
      createdByUserId: string;
      status: string;
      inputKind: string;
      filename: string | null;
      contentType: string | null;
      fileHash: string | null;
      byteSize: number | null;
      rowCount: number;
      columnHeaders: unknown;
      columnMapping: unknown;
      sourceDefault: string;
      dedupeMode: string;
      stagedData: unknown;
      previewSample: unknown;
      report: unknown;
      errorMessage: string | null;
      committedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    },
    opts: { includeStaged: boolean },
  ) {
    return {
      id: row.id,
      companyId: row.companyId,
      createdByUserId: row.createdByUserId,
      status: row.status,
      inputKind: row.inputKind,
      filename: row.filename,
      contentType: row.contentType,
      fileHash: row.fileHash,
      byteSize: row.byteSize,
      rowCount: row.rowCount,
      columnHeaders: asStringArray(row.columnHeaders),
      columnMapping: row.columnMapping ?? null,
      guessedMapping: guessColumnMapping(asStringArray(row.columnHeaders)),
      sourceDefault: row.sourceDefault,
      dedupeMode: row.dedupeMode,
      previewSample: row.previewSample ?? [],
      report: row.report ?? null,
      errorMessage: row.errorMessage,
      committedAt: row.committedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      ...(opts.includeStaged ? { stagedData: row.stagedData } : {}),
    };
  }
}

function detectKind(file: Express.Multer.File): OutboundImportKind {
  const name = (file.originalname || '').toLowerCase();
  const mime = (file.mimetype || '').toLowerCase();
  if (
    name.endsWith('.xlsx') ||
    mime.includes('spreadsheetml') ||
    mime.includes('excel')
  ) {
    return OUTBOUND_IMPORT_KINDS.XLSX;
  }
  return OUTBOUND_IMPORT_KINDS.CSV;
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v));
}

function normalizeMapping(
  raw: Record<string, string | null | undefined>,
): ColumnMapping {
  const out: ColumnMapping = {};
  const keys: (keyof ColumnMapping)[] = [
    'phone',
    'name',
    'email',
    'externalId',
    'source',
    'city',
    'product',
    'value',
    'notes',
  ];
  for (const key of keys) {
    const v = raw[key];
    out[key] = typeof v === 'string' && v.trim() ? v.trim() : null;
  }
  return out;
}
