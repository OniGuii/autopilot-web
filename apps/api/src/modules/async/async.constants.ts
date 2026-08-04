/** Fase 7.1 / 7.1-H / 7.2A — Async queue names and defaults. */

export const ASYNC_QUEUE_PREFIX = 'autopilot:bq';

export const QUEUE_WHATSAPP_INBOUND = 'whatsapp-inbound';
/** BullMQ forbids `:` in queue names — use hyphen. */
export const QUEUE_DLQ_WHATSAPP_INBOUND = 'dlq-whatsapp-inbound';

/** 7.2A — due FollowUp scheduler */
export const QUEUE_FOLLOWUP_SCHEDULER = 'followup-scheduler';

/** 7.2B — operational reconcile */
export const QUEUE_RECONCILE_WORKER = 'reconcile-worker';

/** 7.2C — AI suggestion generation */
export const QUEUE_AI_SUGGESTIONS = 'ai-suggestions';

export const WHATSAPP_INBOUND_JOB_NAME = 'process-webhook';
export const FOLLOWUP_SCHEDULER_JOB_NAME = 'execute-due-followup';
export const RECONCILE_CYCLE_JOB_NAME = 'reconcile-cycle';
export const AI_SUGGESTION_JOB_NAME = 'generate-suggestion';

export const WHATSAPP_INBOUND_ATTEMPTS_DEFAULT = 5;
export const WHATSAPP_INBOUND_BACKOFF_MS_DEFAULT = 2_000;

export const FOLLOWUP_SCHEDULER_ATTEMPTS_DEFAULT = 3;
export const FOLLOWUP_SCHEDULER_BACKOFF_MS_DEFAULT = 5_000;
export const FOLLOWUP_SCHEDULER_CONCURRENCY_DEFAULT = 5;
export const FOLLOWUP_SCHEDULER_SCAN_INTERVAL_MS_DEFAULT = 30_000;
export const FOLLOWUP_SCHEDULER_SCAN_BATCH_DEFAULT = 50;
export const FOLLOWUP_SCHEDULER_BACKLOG_HIGH_DEFAULT = 100;

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

export const FOLLOWUP_SCAN_LOCK_KEY = 'autopilot:followup:scan';
export const RECONCILE_SCAN_LOCK_KEY = 'autopilot:reconcile:scan';

export const RECONCILE_ATTEMPTS_DEFAULT = 2;
export const RECONCILE_BACKOFF_MS_DEFAULT = 30_000;
export const RECONCILE_CONCURRENCY_DEFAULT = 1;
export const RECONCILE_SCAN_INTERVAL_MS_DEFAULT = 5 * 60 * 1000;
export const RECONCILE_TAKE_DEFAULT = 100;

export const AI_SUGGEST_ATTEMPTS_DEFAULT = 3;
export const AI_SUGGEST_BACKOFF_MS_DEFAULT = 3_000;
export const AI_SUGGEST_CONCURRENCY_DEFAULT = 2;
/** OpenAI / job soft timeout (ms). */
export const AI_SUGGEST_TIMEOUT_MS_DEFAULT = 25_000;
/** Bull worker lock — must exceed OpenAI timeout + buffer. */
export const AI_SUGGEST_LOCK_DURATION_MS_DEFAULT = 90_000;
export const AI_SUGGEST_BACKLOG_HIGH_DEFAULT = 50;
/** Min samples before AI_GENERATION_FAILURE_RATE fires. */
export const AI_FAILURE_RATE_MIN_SAMPLES_DEFAULT = 10;
/** Failure rate threshold (0–1). */
export const AI_FAILURE_RATE_THRESHOLD_DEFAULT = 0.5;

/** Resolve concurrency at module load (decorator options are static). */
export function resolveQueueConcurrency(): number {
  const raw =
    process.env.QUEUE_CONCURRENCY ??
    process.env.ASYNC_INBOUND_CONCURRENCY ??
    String(QUEUE_CONCURRENCY_DEFAULT);
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 ? n : QUEUE_CONCURRENCY_DEFAULT;
}

export function resolveFollowupSchedulerConcurrency(): number {
  const raw =
    process.env.FOLLOWUP_SCHEDULER_CONCURRENCY ??
    String(FOLLOWUP_SCHEDULER_CONCURRENCY_DEFAULT);
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1
    ? n
    : FOLLOWUP_SCHEDULER_CONCURRENCY_DEFAULT;
}

export function resolveReconcileConcurrency(): number {
  const raw =
    process.env.RECONCILE_CONCURRENCY ?? String(RECONCILE_CONCURRENCY_DEFAULT);
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 ? n : RECONCILE_CONCURRENCY_DEFAULT;
}

export function resolveAiSuggestConcurrency(): number {
  const raw =
    process.env.AI_SUGGEST_CONCURRENCY ??
    String(AI_SUGGEST_CONCURRENCY_DEFAULT);
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 ? n : AI_SUGGEST_CONCURRENCY_DEFAULT;
}

export function resolveAiSuggestLockDurationMs(): number {
  const raw =
    process.env.AI_SUGGEST_LOCK_DURATION_MS ??
    String(AI_SUGGEST_LOCK_DURATION_MS_DEFAULT);
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 5_000
    ? n
    : AI_SUGGEST_LOCK_DURATION_MS_DEFAULT;
}
