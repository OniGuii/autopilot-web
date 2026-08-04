/**
 * Outbound Message.status machine (Phase 3 — P3-D2 + 6B heal).
 * INBOUND continues to use RECEIVED (Phase 2).
 *
 * Allowed transitions:
 *   PENDING → SENT | FAILED
 *   SENT → DELIVERED
 *   DELIVERED → READ
 *   FAILED → SENT  (6B CH3 — echo heal after UNCERTAIN_TIMEOUT only)
 *
 * Operational note (P3-D3): PENDING older than 5 minutes should be
 * monitored; Ops reconcile can auto-fail stale PENDING.
 */
export const OUTBOUND_MESSAGE_STATUS = {
  PENDING: 'PENDING',
  SENT: 'SENT',
  DELIVERED: 'DELIVERED',
  READ: 'READ',
  FAILED: 'FAILED',
} as const;

export type OutboundMessageStatus =
  (typeof OUTBOUND_MESSAGE_STATUS)[keyof typeof OUTBOUND_MESSAGE_STATUS];

export const PENDING_STALE_MINUTES = 5;

const ALLOWED: Record<string, ReadonlySet<string>> = {
  [OUTBOUND_MESSAGE_STATUS.PENDING]: new Set([
    OUTBOUND_MESSAGE_STATUS.SENT,
    OUTBOUND_MESSAGE_STATUS.FAILED,
  ]),
  [OUTBOUND_MESSAGE_STATUS.SENT]: new Set([OUTBOUND_MESSAGE_STATUS.DELIVERED]),
  [OUTBOUND_MESSAGE_STATUS.DELIVERED]: new Set([OUTBOUND_MESSAGE_STATUS.READ]),
  [OUTBOUND_MESSAGE_STATUS.READ]: new Set(),
  [OUTBOUND_MESSAGE_STATUS.FAILED]: new Set([OUTBOUND_MESSAGE_STATUS.SENT]),
};

export function canTransitionOutboundStatus(
  from: string,
  to: string,
): boolean {
  if (from === to) return false;
  return ALLOWED[from]?.has(to) ?? false;
}

export function isRegressionOrInvalidTransition(
  from: string,
  to: string,
): boolean {
  if (from === to) return false;
  return !canTransitionOutboundStatus(from, to);
}

export function auditActionForStatus(status: string): string | null {
  switch (status) {
    case OUTBOUND_MESSAGE_STATUS.SENT:
      return 'WHATSAPP_MESSAGE_SENT';
    case OUTBOUND_MESSAGE_STATUS.DELIVERED:
      return 'WHATSAPP_MESSAGE_DELIVERED';
    case OUTBOUND_MESSAGE_STATUS.READ:
      return 'WHATSAPP_MESSAGE_READ';
    case OUTBOUND_MESSAGE_STATUS.FAILED:
      return 'WHATSAPP_MESSAGE_FAILED';
    default:
      return null;
  }
}
