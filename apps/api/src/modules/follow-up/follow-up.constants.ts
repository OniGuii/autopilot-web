/** P4-R4 — max send attempts (execute + retries) */
export const FOLLOWUP_MAX_ATTEMPTS = 3;

/**
 * P4-X1 — EXECUTING older than this is reconciled to FAILED (lazy check).
 * Documented operational timeout; no BullMQ scheduler in Phase 4 (P4-Q1).
 */
export const FOLLOWUP_EXECUTING_TIMEOUT_MS = 5 * 60 * 1000;

export const FOLLOWUP_MESSAGE_SOURCE = 'followup' as const;
