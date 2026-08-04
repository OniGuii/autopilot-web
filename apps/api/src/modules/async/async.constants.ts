/** Fase 7.1 — Async Foundation queue names and defaults. */

export const ASYNC_QUEUE_PREFIX = 'autopilot:bq';

export const QUEUE_WHATSAPP_INBOUND = 'whatsapp-inbound';
/** BullMQ forbids `:` in queue names — use hyphen. */
export const QUEUE_DLQ_WHATSAPP_INBOUND = 'dlq-whatsapp-inbound';

export const WHATSAPP_INBOUND_JOB_NAME = 'process-webhook';

export const WHATSAPP_INBOUND_ATTEMPTS_DEFAULT = 5;
export const WHATSAPP_INBOUND_BACKOFF_MS_DEFAULT = 2_000;
export const WHATSAPP_INBOUND_CONCURRENCY_DEFAULT = 10;

/** Bull worker lock — must exceed typical inbound processing. */
export const ASYNC_LOCK_DURATION_MS_DEFAULT = 45_000;
