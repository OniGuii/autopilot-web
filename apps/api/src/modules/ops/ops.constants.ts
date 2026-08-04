/** Stale window for PENDING messages and EXECUTING follow-ups (5 minutes). */
export const OPS_STALE_MS = 5 * 60 * 1000;

/** Max rows per Ops reconcile call (6B CH11). */
export const OPS_RECONCILE_TAKE_DEFAULT = 100;
