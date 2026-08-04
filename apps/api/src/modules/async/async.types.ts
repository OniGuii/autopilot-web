/** Versioned BullMQ payloads (Fase 7.1 / 7.2A). */

export type WhatsappInboundJobPayload = {
  v: 1;
  companyId: string;
  webhookEventId: string;
  instanceId: string;
  eventType: string;
  /** A11 — Job Correlation */
  correlationId: string;
};

export type FollowUpSchedulerJobPayload = {
  v: 1;
  companyId: string;
  followUpId: string;
  correlationId: string;
  trigger: 'schedule';
};

export type ReconcileCycleJobPayload = {
  v: 1;
  correlationId: string;
  trigger: 'schedule';
  /** Cap items inspected/flagged across all companies in this cycle. */
  take: number;
};

export type AiSuggestionJobPayload = {
  v: 1;
  companyId: string;
  conversationId: string;
  actorUserId: string;
  correlationId: string;
  tone?: 'professional' | 'friendly' | 'concise';
  instruction?: string;
  ip?: string;
  userAgent?: string;
};

export type DlqJobPayload = {
  v: 1;
  originalQueue: string;
  originalJobId: string;
  failedReason: string;
  payload: WhatsappInboundJobPayload | FollowUpSchedulerJobPayload;
  correlationId: string;
  failedAt: string;
  attemptsMade: number;
};
