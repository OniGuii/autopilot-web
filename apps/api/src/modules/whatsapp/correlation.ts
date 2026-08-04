import { randomUUID } from 'crypto';

/** CH13 — correlation id for Message / FollowUp / Audit linkage. */
export function newCorrelationId(): string {
  return randomUUID();
}
