/** Fase 7.1 / 7.1-H — Async Foundation queue names and defaults. */

export const ASYNC_QUEUE_PREFIX = 'autopilot:bq';

export const QUEUE_WHATSAPP_INBOUND = 'whatsapp-inbound';
/** BullMQ forbids `:` in queue names — use hyphen. */
export const QUEUE_DLQ_WHATSAPP_INBOUND = 'dlq-whatsapp-inbound';

export const WHATSAPP_INBOUND_JOB_NAME = 'process-webhook';

export const WHATSAPP_INBOUND_ATTEMPTS_DEFAULT = 5;
export const WHATSAPP_INBOUND_BACKOFF_MS_DEFAULT = 2_000;

/** QUEUE_CONCURRENCY (preferred) / ASYNC_INBOUND_CONCURRENCY fallback. */
export const QUEUE_CONCURRENCY_DEFAULT = 10;
export const QUEUE_REMOVE_ON_COMPLETE_DEFAULT = 1_000;
export const QUEUE_REMOVE_ON_FAIL_DEFAULT = 5_000;

export const QUEUE_DLQ_MAX_JOBS_DEFAULT = 1_000;
/** Keep DLQ jobs for 7 days. */
export const QUEUE_DLQ_RETENTION_MS_DEFAULT = 7 * 24 * 60 * 60 * 1000;
/** Alert when oldest DLQ job age exceeds 1 hour. */
export const QUEUE_DLQ_STALE_MS_DEFAULT = 60 * 60 * 1000;

/** Bull worker lock — must exceed typical inbound processing. */
export const ASYNC_LOCK_DURATION_MS_DEFAULT = 45_000;
/** Reclaim PROCESSING claim after stall window. */
export const WEBHOOK_CLAIM_STALE_MS_DEFAULT = 45_000;
/** Alert when WebhookEvent stays RECEIVED longer than this. */
export const WEBHOOK_RECEIVED_STALE_MS_DEFAULT = 5 * 60 * 1000;

/** Resolve concurrency at module load (decorator options are static). */
export function resolveQueueConcurrency(): number {
  const raw =
    process.env.QUEUE_CONCURRENCY ??
    process.env.ASYNC_INBOUND_CONCURRENCY ??
    String(QUEUE_CONCURRENCY_DEFAULT);
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 ? n : QUEUE_CONCURRENCY_DEFAULT;
}
