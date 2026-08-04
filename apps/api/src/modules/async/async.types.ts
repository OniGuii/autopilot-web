/** Versioned BullMQ payloads (Fase 7.1). */

export type WhatsappInboundJobPayload = {
  v: 1;
  companyId: string;
  webhookEventId: string;
  instanceId: string;
  eventType: string;
  /** A11 — Job Correlation */
  correlationId: string;
};

export type DlqJobPayload = {
  v: 1;
  originalQueue: string;
  originalJobId: string;
  failedReason: string;
  payload: WhatsappInboundJobPayload;
  correlationId: string;
  failedAt: string;
  attemptsMade: number;
};
