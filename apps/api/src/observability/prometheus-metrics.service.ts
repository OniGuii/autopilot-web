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
