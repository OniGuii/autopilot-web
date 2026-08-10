import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';
import { AsyncMetricsService } from '../modules/async/async-metrics.service';
import { OBS_PRISMA_SLOW_MS_DEFAULT } from './observability.constants';
import { setPrismaMetricsRecorder } from './prisma-metrics.bridge';

/**
 * Prometheus registry + domain metric bridges (8A).
 * Scraped at GET /metrics — does not replace /api/ops/metrics JSON.
 */
@Injectable()
export class PrometheusMetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrometheusMetricsService.name);
  readonly registry = new Registry();
  private readonly enabled: boolean;
  private readonly prismaSlowMs: number;
  private refreshTimer: NodeJS.Timeout | null = null;

  readonly httpRequestsTotal: Counter<string>;
  readonly httpRequestDuration: Histogram<string>;
  readonly httpErrorsTotal: Counter<string>;

  readonly queueWaiting: Gauge<string>;
  readonly queueActive: Gauge<string>;
  readonly queueCompleted: Gauge<string>;
  readonly queueFailed: Gauge<string>;
  readonly queueJobDuration: Histogram<string>;

  readonly aiGeneratedTotal: Counter<string>;
  readonly aiFailedTotal: Counter<string>;
  readonly aiTokensTotal: Counter<string>;
  readonly aiDuration: Histogram<string>;
  readonly aiClassificationsTotal: Counter<string>;
  readonly aiEscalationsTotal: Counter<string>;
  readonly aiKbMatchesTotal: Counter<string>;
  /** Fase 11B — intent + assist pipeline counters (Prometheus names use `_`). */
  readonly aiIntentCount: Counter<string>;
  readonly aiIntentPrice: Counter<string>;
  readonly aiIntentProduct: Counter<string>;
  readonly aiIntentPayment: Counter<string>;
  readonly aiIntentDelivery: Counter<string>;
  readonly aiIntentHours: Counter<string>;
  readonly aiIntentAddress: Counter<string>;
  readonly aiIntentComplaint: Counter<string>;
  readonly aiIntentHuman: Counter<string>;
  readonly aiIntentUnknown: Counter<string>;
  readonly aiResponseGenerated: Counter<string>;
  readonly aiResponseEscalated: Counter<string>;
  readonly aiKbHit: Counter<string>;
  readonly aiKbMiss: Counter<string>;
  readonly aiAutoSent: Counter<string>;
  readonly aiAutoSkipped: Counter<string>;
  /** Fase 11D — Recovery Engine. */
  readonly aiRecoveryActive: Gauge<string>;
  readonly aiRecoverySent: Counter<string>;
  readonly aiRecoveryStopped: Counter<string>;
  readonly aiRecoveryConverted: Counter<string>;
  readonly aiRecoveryConversionRate: Gauge<string>;
  /** Fase 11E.1 — Sales Memory. */
  readonly salesMemoryUpdatesTotal: Counter<string>;
  readonly salesMemoryFieldsDetectedTotal: Counter<string>;
  readonly salesMemoryConflictsTotal: Counter<string>;
  /** Fase 11E.2 — Lead Scoring temperature transitions. */
  readonly leadScoreHotTotal: Counter<string>;
  readonly leadScoreWarmTotal: Counter<string>;
  readonly leadScoreColdTotal: Counter<string>;
  /** Fase 11E.3 — Objection Engine. */
  readonly objectionDetectedTotal: Counter<string>;
  readonly objectionHandledTotal: Counter<string>;
  readonly objectionEscalatedTotal: Counter<string>;
  /** Fase 11E.4 — Next Best Action. */
  readonly nbaDecidedTotal: Counter<string>;
  readonly nbaChangedTotal: Counter<string>;
  readonly nbaExecutedTotal: Counter<string>;
  /** Fase 11E.5 — Purchase Intent. */
  readonly purchaseIntentCalculatedTotal: Counter<string>;
  readonly purchaseIntentChangedTotal: Counter<string>;
  readonly purchaseIntentHighTotal: Counter<string>;
  readonly purchaseIntentVeryHighTotal: Counter<string>;
  /** Outbound V1.1 — Protection Layer. */
  readonly outboundProtectionAllowedTotal: Counter<string>;
  readonly outboundProtectionBlockedTotal: Counter<string>;
  readonly outboundSuppressAddedTotal: Counter<string>;
  readonly outboundSuppressRemovedTotal: Counter<string>;
  readonly outboundOptOutTotal: Counter<string>;
  readonly outboundProactiveRemainingDaily: Gauge<string>;
  readonly outboundProactiveRemainingHourly: Gauge<string>;

  readonly whatsappSendsTotal: Counter<string>;
  readonly whatsappSendFailuresTotal: Counter<string>;
  readonly whatsappDeliveryLatency: Histogram<string>;

  readonly prismaQueryDuration: Histogram<string>;
  readonly prismaSlowQueriesTotal: Counter<string>;

  private httpWindow: { at: number; status: number; durationMs: number }[] = [];
  /** 8B — in-process window of Prisma slow queries for Ops SLOW_QUERY alert */
  private prismaSlowWindow: {
    at: number;
    model: string;
    operation: string;
    durationMs: number;
  }[] = [];

  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly asyncMetrics?: AsyncMetricsService,
  ) {
    this.enabled = this.config.get<boolean>(
      'observability.metricsEnabled',
      true,
    );
    this.prismaSlowMs = this.config.get<number>(
      'observability.prismaSlowMs',
      OBS_PRISMA_SLOW_MS_DEFAULT,
    );

    this.registry.setDefaultLabels({
      service:
        this.config.get<string>('observability.serviceName') ??
        process.env.OTEL_SERVICE_NAME ??
        'autopilot-api',
    });

    if (this.enabled) {
      collectDefaultMetrics({ register: this.registry });
    }

    this.httpRequestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'HTTP requests',
      labelNames: ['method', 'route', 'status_class'],
      registers: [this.registry],
    });
    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration seconds',
      labelNames: ['method', 'route', 'status_class'],
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
      registers: [this.registry],
    });
    this.httpErrorsTotal = new Counter({
      name: 'http_errors_total',
      help: 'HTTP 5xx responses',
      labelNames: ['method', 'route'],
      registers: [this.registry],
    });

    this.queueWaiting = new Gauge({
      name: 'bullmq_queue_waiting',
      help: 'BullMQ waiting jobs',
      labelNames: ['queue'],
      registers: [this.registry],
    });
    this.queueActive = new Gauge({
      name: 'bullmq_queue_active',
      help: 'BullMQ active jobs',
      labelNames: ['queue'],
      registers: [this.registry],
    });
    this.queueCompleted = new Gauge({
      name: 'bullmq_queue_completed',
      help: 'BullMQ completed jobs (counts snapshot)',
      labelNames: ['queue'],
      registers: [this.registry],
    });
    this.queueFailed = new Gauge({
      name: 'bullmq_queue_failed',
      help: 'BullMQ failed jobs (counts snapshot)',
      labelNames: ['queue'],
      registers: [this.registry],
    });
    this.queueJobDuration = new Histogram({
      name: 'bullmq_job_duration_seconds',
      help: 'BullMQ job processing duration',
      labelNames: ['queue'],
      buckets: [0.05, 0.1, 0.5, 1, 2, 5, 15, 30, 60],
      registers: [this.registry],
    });

    this.aiGeneratedTotal = new Counter({
      name: 'ai_suggestions_generated_total',
      help: 'AI suggestions generated',
      registers: [this.registry],
    });
    this.aiFailedTotal = new Counter({
      name: 'ai_suggestions_failed_total',
      help: 'AI suggestion failures',
      registers: [this.registry],
    });
    this.aiTokensTotal = new Counter({
      name: 'ai_tokens_total',
      help: 'AI tokens consumed',
      labelNames: ['type'],
      registers: [this.registry],
    });
    this.aiDuration = new Histogram({
      name: 'ai_suggestion_duration_seconds',
      help: 'AI suggestion generation duration',
      buckets: [0.5, 1, 2, 5, 10, 25, 60],
      registers: [this.registry],
    });
    this.aiClassificationsTotal = new Counter({
      name: 'ai_classifications_total',
      help: 'AI intent classifications (Fase 11A)',
      registers: [this.registry],
    });
    this.aiEscalationsTotal = new Counter({
      name: 'ai_escalations_total',
      help: 'AI escalations to human (Fase 11A)',
      registers: [this.registry],
    });
    this.aiKbMatchesTotal = new Counter({
      name: 'ai_kb_matches_total',
      help: 'AI knowledge-base matches (Fase 11A)',
      registers: [this.registry],
    });
    this.aiIntentCount = new Counter({
      name: 'ai_intent_count',
      help: 'AI intent classifications processed by assist pipeline (Fase 11B)',
      registers: [this.registry],
    });
    this.aiIntentPrice = new Counter({
      name: 'ai_intent_price',
      help: 'AI intent PRICE (Fase 11B)',
      registers: [this.registry],
    });
    this.aiIntentProduct = new Counter({
      name: 'ai_intent_product',
      help: 'AI intent PRODUCT (Fase 11B)',
      registers: [this.registry],
    });
    this.aiIntentPayment = new Counter({
      name: 'ai_intent_payment',
      help: 'AI intent PAYMENT (Fase 11B)',
      registers: [this.registry],
    });
    this.aiIntentDelivery = new Counter({
      name: 'ai_intent_delivery',
      help: 'AI intent DELIVERY (Fase 11B)',
      registers: [this.registry],
    });
    this.aiIntentHours = new Counter({
      name: 'ai_intent_hours',
      help: 'AI intent HOURS (Fase 11C)',
      registers: [this.registry],
    });
    this.aiIntentAddress = new Counter({
      name: 'ai_intent_address',
      help: 'AI intent ADDRESS (Fase 11C)',
      registers: [this.registry],
    });
    this.aiIntentComplaint = new Counter({
      name: 'ai_intent_complaint',
      help: 'AI intent COMPLAINT (Fase 11B)',
      registers: [this.registry],
    });
    this.aiIntentHuman = new Counter({
      name: 'ai_intent_human',
      help: 'AI intent HUMAN (Fase 11B)',
      registers: [this.registry],
    });
    this.aiIntentUnknown = new Counter({
      name: 'ai_intent_unknown',
      help: 'AI intent UNKNOWN (Fase 11B)',
      registers: [this.registry],
    });
    this.aiResponseGenerated = new Counter({
      name: 'ai_response_generated',
      help: 'AI ASSIST suggested responses generated (Fase 11B)',
      registers: [this.registry],
    });
    this.aiResponseEscalated = new Counter({
      name: 'ai_response_escalated',
      help: 'AI ASSIST responses escalated to human (Fase 11B)',
      registers: [this.registry],
    });
    this.aiKbHit = new Counter({
      name: 'ai_kb_hit',
      help: 'AI knowledge-base resolver hits (Fase 11B)',
      registers: [this.registry],
    });
    this.aiKbMiss = new Counter({
      name: 'ai_kb_miss',
      help: 'AI knowledge-base resolver misses (Fase 11B)',
      registers: [this.registry],
    });
    this.aiAutoSent = new Counter({
      name: 'ai_auto_sent',
      help: 'AI AUTO WhatsApp replies sent (Fase 11C)',
      registers: [this.registry],
    });
    this.aiAutoSkipped = new Counter({
      name: 'ai_auto_skipped',
      help: 'AI AUTO sends skipped / degraded (Fase 11C)',
      registers: [this.registry],
    });
    this.aiRecoveryActive = new Gauge({
      name: 'ai_recovery_active',
      help: 'AI Recovery FollowUps currently SCHEDULED/EXECUTING (Fase 11D)',
      registers: [this.registry],
    });
    this.aiRecoverySent = new Counter({
      name: 'ai_recovery_sent',
      help: 'AI Recovery messages sent (Fase 11D)',
      registers: [this.registry],
    });
    this.aiRecoveryStopped = new Counter({
      name: 'ai_recovery_stopped',
      help: 'AI Recovery flows stopped (Fase 11D)',
      registers: [this.registry],
    });
    this.aiRecoveryConverted = new Counter({
      name: 'ai_recovery_converted',
      help: 'Leads converted after AI Recovery (Fase 11D)',
      registers: [this.registry],
    });
    this.aiRecoveryConversionRate = new Gauge({
      name: 'ai_recovery_conversion_rate',
      help: 'AI Recovery conversion rate (converted / touched) (Fase 11D)',
      registers: [this.registry],
    });
    this.salesMemoryUpdatesTotal = new Counter({
      name: 'sales_memory_updates_total',
      help: 'Sales Memory create/update/clear operations (Fase 11E.1)',
      registers: [this.registry],
    });
    this.salesMemoryFieldsDetectedTotal = new Counter({
      name: 'sales_memory_fields_detected_total',
      help: 'Sales Memory fields detected by rule extractor (Fase 11E.1)',
      labelNames: ['field'],
      registers: [this.registry],
    });
    this.salesMemoryConflictsTotal = new Counter({
      name: 'sales_memory_conflicts_total',
      help: 'Sales Memory slot conflicts on merge (Fase 11E.1)',
      registers: [this.registry],
    });
    this.leadScoreHotTotal = new Counter({
      name: 'lead_score_hot_total',
      help: 'Lead became HOT temperature (Fase 11E.2)',
      registers: [this.registry],
    });
    this.leadScoreWarmTotal = new Counter({
      name: 'lead_score_warm_total',
      help: 'Lead became WARM temperature (Fase 11E.2)',
      registers: [this.registry],
    });
    this.leadScoreColdTotal = new Counter({
      name: 'lead_score_cold_total',
      help: 'Lead became COLD temperature (Fase 11E.2)',
      registers: [this.registry],
    });
    this.objectionDetectedTotal = new Counter({
      name: 'objection_detected_total',
      help: 'Commercial objections detected (Fase 11E.3)',
      labelNames: ['type'],
      registers: [this.registry],
    });
    this.objectionHandledTotal = new Counter({
      name: 'objection_handled_total',
      help: 'Commercial objections handled without escalation (Fase 11E.3)',
      labelNames: ['type'],
      registers: [this.registry],
    });
    this.objectionEscalatedTotal = new Counter({
      name: 'objection_escalated_total',
      help: 'Commercial objections escalated to human (Fase 11E.3)',
      labelNames: ['type'],
      registers: [this.registry],
    });
    this.nbaDecidedTotal = new Counter({
      name: 'nba_decided_total',
      help: 'Next Best Action decisions (Fase 11E.4)',
      labelNames: ['action'],
      registers: [this.registry],
    });
    this.nbaChangedTotal = new Counter({
      name: 'nba_changed_total',
      help: 'Next Best Action changes vs previous (Fase 11E.4)',
      labelNames: ['action'],
      registers: [this.registry],
    });
    this.nbaExecutedTotal = new Counter({
      name: 'nba_executed_total',
      help: 'Next Best Action applied to reply enrichment (Fase 11E.4)',
      labelNames: ['action'],
      registers: [this.registry],
    });
    this.purchaseIntentCalculatedTotal = new Counter({
      name: 'purchase_intent_calculated_total',
      help: 'Purchase Intent calculations (Fase 11E.5)',
      labelNames: ['band'],
      registers: [this.registry],
    });
    this.purchaseIntentChangedTotal = new Counter({
      name: 'purchase_intent_changed_total',
      help: 'Purchase Intent band changes (Fase 11E.5)',
      labelNames: ['band'],
      registers: [this.registry],
    });
    this.purchaseIntentHighTotal = new Counter({
      name: 'purchase_intent_high_total',
      help: 'Purchase Intent entered HIGH band (Fase 11E.5)',
      registers: [this.registry],
    });
    this.purchaseIntentVeryHighTotal = new Counter({
      name: 'purchase_intent_very_high_total',
      help: 'Purchase Intent entered VERY_HIGH band (Fase 11E.5)',
      registers: [this.registry],
    });

    this.outboundProtectionAllowedTotal = new Counter({
      name: 'outbound_protection_allowed_total',
      help: 'Outbound Protection allowed proactive evaluations (V1.1)',
      labelNames: ['source'],
      registers: [this.registry],
    });
    this.outboundProtectionBlockedTotal = new Counter({
      name: 'outbound_protection_blocked_total',
      help: 'Outbound Protection blocked proactive evaluations (V1.1)',
      labelNames: ['reason'],
      registers: [this.registry],
    });
    this.outboundSuppressAddedTotal = new Counter({
      name: 'outbound_suppress_added_total',
      help: 'Outbound suppress entries added/reactivated (V1.1)',
      registers: [this.registry],
    });
    this.outboundSuppressRemovedTotal = new Counter({
      name: 'outbound_suppress_removed_total',
      help: 'Outbound suppress entries deactivated (V1.1)',
      registers: [this.registry],
    });
    this.outboundOptOutTotal = new Counter({
      name: 'outbound_opt_out_total',
      help: 'Outbound keyword opt-outs (V1.1)',
      registers: [this.registry],
    });
    this.outboundProactiveRemainingDaily = new Gauge({
      name: 'outbound_proactive_remaining_daily',
      help: 'Remaining daily proactive outbound capacity (last evaluate)',
      registers: [this.registry],
    });
    this.outboundProactiveRemainingHourly = new Gauge({
      name: 'outbound_proactive_remaining_hourly',
      help: 'Remaining hourly proactive outbound capacity (last evaluate)',
      registers: [this.registry],
    });

    this.whatsappSendsTotal = new Counter({
      name: 'whatsapp_sends_total',
      help: 'WhatsApp outbound send attempts',
      labelNames: ['result'],
      registers: [this.registry],
    });
    this.whatsappSendFailuresTotal = new Counter({
      name: 'whatsapp_send_failures_total',
      help: 'WhatsApp outbound send failures',
      registers: [this.registry],
    });
    this.whatsappDeliveryLatency = new Histogram({
      name: 'whatsapp_delivery_latency_seconds',
      help: 'WhatsApp delivery ack latency from send',
      buckets: [0.5, 1, 2, 5, 15, 30, 60, 120],
      registers: [this.registry],
    });

    this.prismaQueryDuration = new Histogram({
      name: 'prisma_query_duration_seconds',
      help: 'Prisma query duration',
      labelNames: ['model', 'operation'],
      buckets: [0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
      registers: [this.registry],
    });
    this.prismaSlowQueriesTotal = new Counter({
      name: 'prisma_slow_queries_total',
      help: 'Prisma queries slower than threshold',
      labelNames: ['model', 'operation'],
      registers: [this.registry],
    });
  }

  onModuleInit(): void {
    setPrismaMetricsRecorder((model, operation, durationMs) => {
      this.recordPrismaQuery(model, operation, durationMs);
    });
    if (!this.enabled) return;
    this.refreshTimer = setInterval(() => {
      void this.refreshQueueGauges().catch((err) => {
        this.logger.warn(
          `queue gauge refresh failed: ${err instanceof Error ? err.message : err}`,
        );
      });
    }, 15_000);
    this.refreshTimer.unref?.();
  }

  onModuleDestroy(): void {
    setPrismaMetricsRecorder(null);
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async render(): Promise<string> {
    if (this.enabled) {
      await this.refreshQueueGauges();
    }
    return this.registry.metrics();
  }

  contentType(): string {
    return this.registry.contentType;
  }

  recordHttp(input: {
    method: string;
    route: string;
    statusCode: number;
    durationMs: number;
  }): void {
    const statusClass = `${Math.floor(input.statusCode / 100)}xx`;
    const labels = {
      method: input.method,
      route: input.route,
      status_class: statusClass,
    };
    this.httpRequestsTotal.inc(labels);
    this.httpRequestDuration.observe(labels, input.durationMs / 1000);
    if (input.statusCode >= 500) {
      this.httpErrorsTotal.inc({
        method: input.method,
        route: input.route,
      });
    }
    const now = Date.now();
    this.httpWindow.push({
      at: now,
      status: input.statusCode,
      durationMs: input.durationMs,
    });
    const cutoff = now - 15 * 60_000;
    this.httpWindow = this.httpWindow.filter((s) => s.at >= cutoff);
    if (this.httpWindow.length > 5_000) {
      this.httpWindow = this.httpWindow.slice(-5_000);
    }
  }

  recordQueueJobDuration(queue: string, durationMs: number): void {
    this.queueJobDuration.observe({ queue }, durationMs / 1000);
  }

  recordAiSuccess(
    durationMs: number,
    usage?: {
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
    },
  ): void {
    this.aiGeneratedTotal.inc();
    this.aiDuration.observe(durationMs / 1000);
    if (usage?.promptTokens) {
      this.aiTokensTotal.inc({ type: 'prompt' }, usage.promptTokens);
    }
    if (usage?.completionTokens) {
      this.aiTokensTotal.inc({ type: 'completion' }, usage.completionTokens);
    }
    if (usage?.totalTokens) {
      this.aiTokensTotal.inc({ type: 'total' }, usage.totalTokens);
    }
  }

  recordAiFailure(): void {
    this.aiFailedTotal.inc();
  }

  recordAiClassification(): void {
    this.aiClassificationsTotal.inc();
  }

  recordAiEscalation(): void {
    this.aiEscalationsTotal.inc();
  }

  recordAiKbMatch(): void {
    this.aiKbMatchesTotal.inc();
  }

  recordAiIntent(intent: string): void {
    this.aiIntentCount.inc();
    switch ((intent || 'UNKNOWN').toUpperCase()) {
      case 'PRICE':
        this.aiIntentPrice.inc();
        break;
      case 'PRODUCT':
        this.aiIntentProduct.inc();
        break;
      case 'PAYMENT':
        this.aiIntentPayment.inc();
        break;
      case 'DELIVERY':
        this.aiIntentDelivery.inc();
        break;
      case 'HOURS':
        this.aiIntentHours.inc();
        break;
      case 'ADDRESS':
        this.aiIntentAddress.inc();
        break;
      case 'COMPLAINT':
        this.aiIntentComplaint.inc();
        break;
      case 'HUMAN':
        this.aiIntentHuman.inc();
        break;
      default:
        this.aiIntentUnknown.inc();
        break;
    }
  }

  recordAiResponseGenerated(): void {
    this.aiResponseGenerated.inc();
  }

  recordAiResponseEscalated(): void {
    this.aiResponseEscalated.inc();
  }

  recordAiKbHit(): void {
    this.aiKbHit.inc();
  }

  recordAiKbMiss(): void {
    this.aiKbMiss.inc();
  }

  recordAiAutoSent(): void {
    this.aiAutoSent.inc();
  }

  recordAiAutoSkipped(): void {
    this.aiAutoSkipped.inc();
  }

  recordAiRecoveryActiveDelta(delta: number): void {
    if (delta !== 0) this.aiRecoveryActive.inc(delta);
  }

  recordAiRecoverySent(): void {
    this.aiRecoverySent.inc();
  }

  recordAiRecoveryStopped(n = 1): void {
    if (n > 0) this.aiRecoveryStopped.inc(n);
  }

  recordAiRecoveryConverted(): void {
    this.aiRecoveryConverted.inc();
  }

  setAiRecoveryConversionRate(rate: number | null): void {
    if (rate == null || Number.isNaN(rate)) {
      this.aiRecoveryConversionRate.set(0);
      return;
    }
    this.aiRecoveryConversionRate.set(rate);
  }

  recordSalesMemoryUpdate(): void {
    this.salesMemoryUpdatesTotal.inc();
  }

  recordSalesMemoryFieldDetected(field: string): void {
    this.salesMemoryFieldsDetectedTotal.inc({ field: field || 'unknown' });
  }

  recordSalesMemoryConflicts(n = 1): void {
    if (n > 0) this.salesMemoryConflictsTotal.inc(n);
  }

  recordLeadScoreTemperature(temperature: 'HOT' | 'WARM' | 'COLD'): void {
    if (temperature === 'HOT') this.leadScoreHotTotal.inc();
    else if (temperature === 'WARM') this.leadScoreWarmTotal.inc();
    else this.leadScoreColdTotal.inc();
  }

  recordObjectionDetected(type: string): void {
    this.objectionDetectedTotal.inc({ type: type || 'UNKNOWN' });
  }

  recordObjectionHandled(type: string): void {
    this.objectionHandledTotal.inc({ type: type || 'UNKNOWN' });
  }

  recordObjectionEscalated(type: string): void {
    this.objectionEscalatedTotal.inc({ type: type || 'UNKNOWN' });
  }

  recordNbaDecided(action: string): void {
    this.nbaDecidedTotal.inc({ action: action || 'WAIT' });
  }

  recordNbaChanged(action: string): void {
    this.nbaChangedTotal.inc({ action: action || 'WAIT' });
  }

  recordNbaExecuted(action: string): void {
    this.nbaExecutedTotal.inc({ action: action || 'WAIT' });
  }

  recordPurchaseIntentCalculated(band: string): void {
    this.purchaseIntentCalculatedTotal.inc({ band: band || 'VERY_LOW' });
  }

  recordPurchaseIntentChanged(band: string): void {
    this.purchaseIntentChangedTotal.inc({ band: band || 'VERY_LOW' });
  }

  recordPurchaseIntentHigh(): void {
    this.purchaseIntentHighTotal.inc();
  }

  recordPurchaseIntentVeryHigh(): void {
    this.purchaseIntentVeryHighTotal.inc();
  }

  recordOutboundProtectionAllowed(source: string): void {
    this.outboundProtectionAllowedTotal.inc({
      source: source || 'unknown',
    });
  }

  recordOutboundProtectionBlocked(reason: string): void {
    this.outboundProtectionBlockedTotal.inc({
      reason: reason || 'unknown',
    });
  }

  recordOutboundSuppressAdded(): void {
    this.outboundSuppressAddedTotal.inc();
  }

  recordOutboundSuppressRemoved(): void {
    this.outboundSuppressRemovedTotal.inc();
  }

  recordOutboundOptOut(): void {
    this.outboundOptOutTotal.inc();
  }

  setOutboundProactiveRemainingDaily(n: number): void {
    this.outboundProactiveRemainingDaily.set(Math.max(0, n));
  }

  setOutboundProactiveRemainingHourly(n: number): void {
    this.outboundProactiveRemainingHourly.set(Math.max(0, n));
  }

  recordWhatsappSend(ok: boolean): void {
    this.whatsappSendsTotal.inc({ result: ok ? 'ok' : 'error' });
    if (!ok) this.whatsappSendFailuresTotal.inc();
  }

  recordWhatsappDeliveryLatency(latencyMs: number): void {
    if (latencyMs >= 0) {
      this.whatsappDeliveryLatency.observe(latencyMs / 1000);
    }
  }

  recordPrismaQuery(
    model: string,
    operation: string,
    durationMs: number,
  ): void {
    const m = model || 'raw';
    const op = operation || 'query';
    this.prismaQueryDuration.observe(
      { model: m, operation: op },
      durationMs / 1000,
    );
    if (durationMs >= this.prismaSlowMs) {
      this.prismaSlowQueriesTotal.inc({ model: m, operation: op });
      const now = Date.now();
      this.prismaSlowWindow.push({
        at: now,
        model: m,
        operation: op,
        durationMs,
      });
      const cutoff = now - 15 * 60_000;
      this.prismaSlowWindow = this.prismaSlowWindow.filter(
        (s) => s.at >= cutoff,
      );
      if (this.prismaSlowWindow.length > 2_000) {
        this.prismaSlowWindow = this.prismaSlowWindow.slice(-2_000);
      }
    }
  }

  /** In-process window for Ops alerts (8A). */
  getHttpWindowStats(): {
    total: number;
    errors5xx: number;
    errorRate: number;
    p95Ms: number | null;
  } {
    const total = this.httpWindow.length;
    const errors5xx = this.httpWindow.filter((s) => s.status >= 500).length;
    const durations = this.httpWindow
      .map((s) => s.durationMs)
      .sort((a, b) => a - b);
    let p95Ms: number | null = null;
    if (durations.length > 0) {
      const idx = Math.min(
        durations.length - 1,
        Math.floor(durations.length * 0.95),
      );
      p95Ms = durations[idx] ?? null;
    }
    return {
      total,
      errors5xx,
      errorRate: total > 0 ? errors5xx / total : 0,
      p95Ms,
    };
  }

  /** 8B — slow Prisma queries in the last 15 minutes (Ops SLOW_QUERY). */
  getPrismaSlowWindowStats(): {
    count: number;
    thresholdMs: number;
  } {
    const now = Date.now();
    const cutoff = now - 15 * 60_000;
    this.prismaSlowWindow = this.prismaSlowWindow.filter((s) => s.at >= cutoff);
    return {
      count: this.prismaSlowWindow.length,
      thresholdMs: this.prismaSlowMs,
    };
  }

  private async refreshQueueGauges(): Promise<void> {
    if (!this.asyncMetrics) return;
    const snap = await this.asyncMetrics.snapshot();
    if (!snap.available) return;

    const map: Array<[string, typeof snap.whatsappInbound]> = [
      ['whatsapp-inbound', snap.whatsappInbound],
      ['followup-scheduler', snap.followupScheduler],
      ['reconcile-worker', snap.reconcileWorker],
      ['ai-suggestions', snap.aiSuggestions],
      [
        'outbound-send',
        snap.outbound
          ? {
              waiting: snap.outbound.waiting,
              active: snap.outbound.active,
              completed: snap.outbound.completed,
              failed: snap.outbound.failed,
              delayed: snap.outbound.delayed,
            }
          : null,
      ],
    ];
    for (const [queue, counts] of map) {
      if (!counts) continue;
      this.queueWaiting.set({ queue }, counts.waiting);
      this.queueActive.set({ queue }, counts.active);
      this.queueCompleted.set({ queue }, counts.completed);
      this.queueFailed.set({ queue }, counts.failed);
    }
  }
}
