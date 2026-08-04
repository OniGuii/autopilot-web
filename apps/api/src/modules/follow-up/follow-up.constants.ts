/** P4-R4 — max send attempts (execute + retries) */
export const FOLLOWUP_MAX_ATTEMPTS = 3;

/**
 * P4-X1 — EXECUTING older than this is reconciled to FAILED (lazy check).
 * 7.2A scheduler also uses this for FOLLOWUP_STUCK_EXECUTING alerts.
 */
export const FOLLOWUP_EXECUTING_TIMEOUT_MS = 5 * 60 * 1000;

export const FOLLOWUP_MESSAGE_SOURCE = 'followup' as const;

/** Synthetic session id for scheduler-driven executes (audit/send actor). */
export const FOLLOWUP_SCHEDULER_SID = 'followup-scheduler';
