import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PrometheusMetricsService } from '../../observability/prometheus-metrics.service';
import { AuditService } from '../audit/audit.service';
import {
  OBJECTION_HISTORY_MAX,
  SALES_MEMORY_CLEARED,
  SALES_MEMORY_CREATED,
  SALES_MEMORY_KEY,
  SALES_MEMORY_PRODUCT_INTEREST_MAX,
  SALES_MEMORY_SOURCE_MESSAGE_IDS_MAX,
  SALES_MEMORY_UPDATED,
} from './ai.constants';
import { SalesMemoryExtractorService } from './sales-memory-extractor.service';
import type {
  ObjectionHistoryEntry,
  SalesMemory,
  SalesMemoryField,
  SalesMemoryMergeResult,
  SalesMemoryPatch,
  SalesObjectionCode,
  SalesPurchaseIntentLevel,
} from './sales-memory.types';

type Actor = { cid: string; sub: string };

const EMPTY_SLOTS = {
  budget: null as string | null,
  productInterest: [] as string[],
  city: null as string | null,
  urgency: null as SalesMemory['urgency'],
  paymentPreference: null as string | null,
  deliveryPreference: null as string | null,
  lastObjection: null as SalesMemory['lastObjection'],
  objectionHistory: [] as ObjectionHistoryEntry[],
  purchaseIntentLevel: 'NONE' as SalesPurchaseIntentLevel,
};

@Injectable()
export class SalesMemoryService {
  private readonly logger = new Logger(SalesMemoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly extractor: SalesMemoryExtractorService,
    @Optional() private readonly prom?: PrometheusMetricsService,
  ) {}

  emptyMemory(): SalesMemory {
    return {
      ...EMPTY_SLOTS,
      version: 0,
      updatedAt: new Date(0).toISOString(),
      sourceMessageIds: [],
      score: 0,
      temperature: 'COLD',
      lastScoreAt: null,
    };
  }

  async loadMemory(
    companyId: string,
    conversationId: string,
  ): Promise<SalesMemory> {
    const conv = await this.prisma.conversation.findFirst({
      where: { id: conversationId, companyId, deletedAt: null },
      select: { metadata: true },
    });
    if (!conv) {
      throw new NotFoundException('Conversation not found');
    }
    return this.readFromMetadata(conv.metadata);
  }

  /**
   * Extract slots from inbound text and merge into Conversation.metadata.salesMemory.
   * Fire-and-forget safe: does not throw for empty patches.
   */
  async updateFromInbound(input: {
    companyId: string;
    conversationId: string;
    messageId: string;
    messageBody: string;
    intent?: import('@prisma/client').AiIntent | null;
  }): Promise<SalesMemoryMergeResult | null> {
    const patch = this.extractor.extract({
      message: input.messageBody,
      intent: input.intent,
    });
    if (Object.keys(patch).length === 0) {
      return null;
    }
    return this.updateMemory({
      companyId: input.companyId,
      conversationId: input.conversationId,
      patch,
      messageId: input.messageId,
    });
  }

  async updateMemory(input: {
    companyId: string;
    conversationId: string;
    patch: SalesMemoryPatch;
    messageId?: string;
    actorUserId?: string | null;
  }): Promise<SalesMemoryMergeResult> {
    const conv = await this.prisma.conversation.findFirst({
      where: {
        id: input.conversationId,
        companyId: input.companyId,
        deletedAt: null,
      },
      select: { id: true, metadata: true },
    });
    if (!conv) {
      throw new NotFoundException('Conversation not found');
    }

    const before = this.readFromMetadata(conv.metadata);
    const created = before.version === 0;
    const merged = this.mergeMemory(before, input.patch, input.messageId);

    if (!merged.changed && !created) {
      return merged;
    }

    const nextMeta = this.writeToMetadata(conv.metadata, merged.memory);

    await this.prisma.$transaction(async (tx) => {
      await tx.conversation.update({
        where: { id: conv.id },
        data: { metadata: nextMeta as Prisma.InputJsonValue },
      });
      await this.audit.write(tx, {
        companyId: input.companyId,
        actorUserId: input.actorUserId ?? null,
        action: created ? SALES_MEMORY_CREATED : SALES_MEMORY_UPDATED,
        targetType: 'CONVERSATION',
        targetId: conv.id,
        before: created ? null : this.auditSnapshot(before),
        after: {
          ...this.auditSnapshot(merged.memory),
          fieldsDetected: merged.fieldsDetected,
          conflicts: merged.conflicts,
        },
      });
    });

    this.prom?.recordSalesMemoryUpdate();
    for (const field of merged.fieldsDetected) {
      this.prom?.recordSalesMemoryFieldDetected(field);
    }
    if (merged.conflicts.length > 0) {
      this.prom?.recordSalesMemoryConflicts(merged.conflicts.length);
    }

    this.logger.debug(
      `sales memory ${created ? 'created' : 'updated'} conversation=${conv.id} fields=${merged.fieldsDetected.join(',')}`,
    );

    return { ...merged, created };
  }

  mergeMemory(
    current: SalesMemory,
    patch: SalesMemoryPatch,
    messageId?: string,
  ): SalesMemoryMergeResult {
    const fieldsDetected: SalesMemoryField[] = [];
    const conflicts: SalesMemoryField[] = [];
    const next: SalesMemory = {
      ...current,
      productInterest: [...current.productInterest],
      objectionHistory: [...current.objectionHistory],
      sourceMessageIds: [...current.sourceMessageIds],
      // 11E.2 — preserve score fields; LeadScoringService owns updates.
      score: current.score,
      temperature: current.temperature,
      lastScoreAt: current.lastScoreAt,
    };

    const applyScalar = <K extends SalesMemoryField>(
      key: K,
      value: SalesMemory[K] | undefined,
      isEmpty: (v: SalesMemory[K]) => boolean,
      equal: (a: SalesMemory[K], b: SalesMemory[K]) => boolean,
    ) => {
      if (value === undefined || isEmpty(value)) return;
      fieldsDetected.push(key);
      const prev = next[key];
      if (!isEmpty(prev) && !equal(prev, value)) {
        conflicts.push(key);
      }
      // null never wins; non-null patch wins (last inbound), conflict recorded.
      next[key] = value;
    };

    applyScalar(
      'budget',
      patch.budget,
      (v) => v == null || v === '',
      (a, b) => a === b,
    );
    applyScalar(
      'city',
      patch.city,
      (v) => v == null || v === '',
      (a, b) => a === b,
    );
    applyScalar(
      'urgency',
      patch.urgency,
      (v) => v == null,
      (a, b) => a === b,
    );
    applyScalar(
      'paymentPreference',
      patch.paymentPreference,
      (v) => v == null || v === '',
      (a, b) => a === b,
    );
    applyScalar(
      'deliveryPreference',
      patch.deliveryPreference,
      (v) => v == null || v === '',
      (a, b) => a === b,
    );
    applyScalar(
      'lastObjection',
      patch.lastObjection,
      (v) => v == null,
      (a, b) => a === b,
    );

    if (patch.objectionHistory && patch.objectionHistory.length > 0) {
      fieldsDetected.push('objectionHistory');
      const seen = new Set(
        next.objectionHistory.map(
          (h) => `${h.type}|${h.at}|${h.messageId ?? ''}`,
        ),
      );
      for (const h of patch.objectionHistory) {
        const key = `${h.type}|${h.at}|${h.messageId ?? ''}`;
        if (!seen.has(key)) {
          next.objectionHistory.push(h);
          seen.add(key);
        }
      }
      next.objectionHistory = next.objectionHistory.slice(
        -OBJECTION_HISTORY_MAX,
      );
    }

    if (patch.purchaseIntentLevel !== undefined) {
      fieldsDetected.push('purchaseIntentLevel');
      const rank = (l: SalesPurchaseIntentLevel) =>
        ({ NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3 })[l];
      if (
        next.purchaseIntentLevel !== 'NONE' &&
        next.purchaseIntentLevel !== patch.purchaseIntentLevel
      ) {
        conflicts.push('purchaseIntentLevel');
      }
      // Keep the stronger purchase signal (never downgrade via weak extract).
      if (rank(patch.purchaseIntentLevel) >= rank(next.purchaseIntentLevel)) {
        next.purchaseIntentLevel = patch.purchaseIntentLevel;
      }
    }

    if (patch.productInterest && patch.productInterest.length > 0) {
      fieldsDetected.push('productInterest');
      const beforeSet = new Set(
        next.productInterest.map((p) => p.toLowerCase()),
      );
      let added = false;
      for (const p of patch.productInterest) {
        const key = p.toLowerCase();
        if (!beforeSet.has(key)) {
          next.productInterest.push(p);
          beforeSet.add(key);
          added = true;
        }
      }
      next.productInterest = next.productInterest.slice(
        0,
        SALES_MEMORY_PRODUCT_INTEREST_MAX,
      );
      if (
        !added &&
        patch.productInterest.some((p) => beforeSet.has(p.toLowerCase()))
      ) {
        // same products — not a conflict; no-op for list
      }
    }

    const changed =
      fieldsDetected.length > 0 &&
      (JSON.stringify(this.auditSnapshot(current)) !==
        JSON.stringify(this.auditSnapshot(next)) ||
        current.version === 0);

    if (!changed) {
      return {
        memory: current,
        created: current.version === 0,
        changed: false,
        fieldsDetected,
        conflicts,
      };
    }

    if (messageId) {
      next.sourceMessageIds = [
        ...next.sourceMessageIds.filter((id) => id !== messageId),
        messageId,
      ].slice(-SALES_MEMORY_SOURCE_MESSAGE_IDS_MAX);
    }

    next.version = current.version + 1;
    next.updatedAt = new Date().toISOString();

    return {
      memory: next,
      created: current.version === 0,
      changed: true,
      fieldsDetected,
      conflicts,
    };
  }

  async clearMemory(input: {
    companyId: string;
    conversationId: string;
    actorUserId?: string | null;
  }): Promise<SalesMemory> {
    const conv = await this.prisma.conversation.findFirst({
      where: {
        id: input.conversationId,
        companyId: input.companyId,
        deletedAt: null,
      },
      select: { id: true, metadata: true },
    });
    if (!conv) {
      throw new NotFoundException('Conversation not found');
    }

    const before = this.readFromMetadata(conv.metadata);
    const cleared = this.emptyMemory();
    cleared.version = before.version + 1;
    cleared.updatedAt = new Date().toISOString();

    const nextMeta = this.writeToMetadata(conv.metadata, cleared);

    await this.prisma.$transaction(async (tx) => {
      await tx.conversation.update({
        where: { id: conv.id },
        data: { metadata: nextMeta as Prisma.InputJsonValue },
      });
      await this.audit.write(tx, {
        companyId: input.companyId,
        actorUserId: input.actorUserId ?? null,
        action: SALES_MEMORY_CLEARED,
        targetType: 'CONVERSATION',
        targetId: conv.id,
        before: this.auditSnapshot(before),
        after: this.auditSnapshot(cleared),
      });
    });

    this.prom?.recordSalesMemoryUpdate();
    return cleared;
  }

  /** Debug endpoint helper. */
  async getForDebug(actor: Actor, conversationId: string) {
    const memory = await this.loadMemory(actor.cid, conversationId);
    return {
      companyId: actor.cid,
      conversationId,
      memory,
    };
  }

  /** Compact text for Recovery / future NBA prompts. */
  formatForPrompt(memory: SalesMemory): string | null {
    if (memory.version === 0) return null;
    const bits: string[] = [];
    if (memory.productInterest.length) {
      bits.push(`interesse: ${memory.productInterest.join(', ')}`);
    }
    if (memory.budget) bits.push(`orçamento: ${memory.budget}`);
    if (memory.city) bits.push(`cidade: ${memory.city}`);
    if (memory.urgency) bits.push(`urgência: ${memory.urgency}`);
    if (memory.paymentPreference) {
      bits.push(`pagamento: ${memory.paymentPreference}`);
    }
    if (memory.deliveryPreference) {
      bits.push(`entrega: ${memory.deliveryPreference}`);
    }
    if (memory.lastObjection) bits.push(`objeção: ${memory.lastObjection}`);
    if (memory.objectionHistory.length > 0) {
      bits.push(`objeções: ${memory.objectionHistory.length}`);
    }
    if (memory.purchaseIntentLevel !== 'NONE') {
      bits.push(`intenção: ${memory.purchaseIntentLevel}`);
    }
    if (memory.lastScoreAt != null || memory.score > 0) {
      bits.push(`score: ${memory.score} (${memory.temperature})`);
    }
    return bits.length ? bits.join(' · ') : null;
  }

  readFromMetadata(metadata: unknown): SalesMemory {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return this.emptyMemory();
    }
    const root = metadata as Record<string, unknown>;
    const raw = root[SALES_MEMORY_KEY];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return this.emptyMemory();
    }
    const m = raw as Record<string, unknown>;
    return {
      budget: typeof m.budget === 'string' ? m.budget : null,
      productInterest: Array.isArray(m.productInterest)
        ? m.productInterest.filter((x): x is string => typeof x === 'string')
        : [],
      city: typeof m.city === 'string' ? m.city : null,
      urgency:
        m.urgency === 'LOW' || m.urgency === 'MEDIUM' || m.urgency === 'HIGH'
          ? m.urgency
          : null,
      paymentPreference:
        typeof m.paymentPreference === 'string' ? m.paymentPreference : null,
      deliveryPreference:
        typeof m.deliveryPreference === 'string' ? m.deliveryPreference : null,
      lastObjection: this.parseObjection(m.lastObjection),
      objectionHistory: this.parseObjectionHistory(m.objectionHistory),
      purchaseIntentLevel: this.parsePurchase(m.purchaseIntentLevel),
      version: typeof m.version === 'number' && m.version >= 0 ? m.version : 0,
      updatedAt:
        typeof m.updatedAt === 'string'
          ? m.updatedAt
          : new Date(0).toISOString(),
      sourceMessageIds: Array.isArray(m.sourceMessageIds)
        ? m.sourceMessageIds.filter((x): x is string => typeof x === 'string')
        : [],
      score:
        typeof m.score === 'number' && Number.isFinite(m.score)
          ? Math.max(0, Math.min(100, Math.round(m.score)))
          : 0,
      temperature:
        m.temperature === 'HOT' ||
        m.temperature === 'WARM' ||
        m.temperature === 'COLD'
          ? m.temperature
          : 'COLD',
      lastScoreAt: typeof m.lastScoreAt === 'string' ? m.lastScoreAt : null,
    };
  }

  private writeToMetadata(
    metadata: unknown,
    memory: SalesMemory,
  ): Record<string, unknown> {
    const root =
      metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? { ...(metadata as Record<string, unknown>) }
        : {};
    root[SALES_MEMORY_KEY] = memory;
    return root;
  }

  private parseObjection(v: unknown): SalesMemory['lastObjection'] {
    if (typeof v !== 'string') return null;
    const legacy: Record<string, SalesObjectionCode> = {
      CARO: 'PRICE',
      SEM_TEMPO: 'TIME',
      PRECISO_PENSAR: 'TIME',
      VER_COM_SOCIO: 'AUTHORITY',
      COMPARANDO_CONCORRENTE: 'COMPARISON',
    };
    if (legacy[v]) return legacy[v];
    const allowed: SalesObjectionCode[] = [
      'PRICE',
      'TIME',
      'TRUST',
      'COMPARISON',
      'AUTHORITY',
      'NEED',
      'UNKNOWN',
    ];
    return allowed.includes(v as SalesObjectionCode)
      ? (v as SalesObjectionCode)
      : null;
  }

  private parseObjectionHistory(v: unknown): ObjectionHistoryEntry[] {
    if (!Array.isArray(v)) return [];
    const out: ObjectionHistoryEntry[] = [];
    for (const raw of v) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const row = raw as Record<string, unknown>;
      const type = this.parseObjection(row.type);
      if (!type || typeof row.at !== 'string') continue;
      out.push({
        type,
        at: row.at,
        ...(typeof row.messageId === 'string'
          ? { messageId: row.messageId }
          : {}),
      });
    }
    return out.slice(-OBJECTION_HISTORY_MAX);
  }

  private parsePurchase(v: unknown): SalesPurchaseIntentLevel {
    if (v === 'LOW' || v === 'MEDIUM' || v === 'HIGH' || v === 'NONE') return v;
    return 'NONE';
  }

  private auditSnapshot(memory: SalesMemory) {
    return {
      version: memory.version,
      budget: memory.budget,
      productInterest: memory.productInterest,
      city: memory.city,
      urgency: memory.urgency,
      paymentPreference: memory.paymentPreference,
      deliveryPreference: memory.deliveryPreference,
      lastObjection: memory.lastObjection,
      objectionHistory: memory.objectionHistory,
      purchaseIntentLevel: memory.purchaseIntentLevel,
      score: memory.score,
      temperature: memory.temperature,
      lastScoreAt: memory.lastScoreAt,
      updatedAt: memory.updatedAt,
    };
  }
}
