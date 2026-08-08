/** FollowUp.type for AI-generated reply suggestions. */
export const AI_FOLLOWUP_TYPE = 'AI_REPLY' as const;

/** FollowUp.metadata.source marker for AI suggestions. */
export const AI_METADATA_SOURCE = 'ai' as const;

export const AI_CONTEXT_MAX_MESSAGES = 20;
export const AI_CONTEXT_MAX_CHARS = 8000;
export const AI_MSG_BODY_MAX_CHARS = 1000;
export const AI_SUGGESTION_MAX_CHARS = 4096;
export const AI_INSTRUCTION_MAX_CHARS = 500;

export const AI_RATE_LIMIT_PER_MINUTE = 10;
export const AI_RATE_LIMIT_PER_DAY = 200;

export const AI_MAX_COMPLETION_TOKENS = 400;
export const AI_TEMPERATURE = 0.4;
export const AI_OPENAI_TIMEOUT_MS = 25_000;

/** Distributed Redis lock TTL (covers OpenAI timeout + buffer). */
export const AI_GENERATION_LOCK_TTL_MS = 90_000;
export const AI_GENERATION_LOCK_PREFIX = 'autopilot:ai:gen-lock:';

export const AI_PROMPT_VERSION = 'suggest-reply.v1';

/** Audit actions (Fase 5 — ajustes aprovados). */
export const AI_SUGGESTION_GENERATED = 'AI_SUGGESTION_GENERATED';
export const AI_SUGGESTION_APPROVED = 'AI_SUGGESTION_APPROVED';
export const AI_SUGGESTION_REJECTED = 'AI_SUGGESTION_REJECTED';

/** Fase 11A — agent audit actions. */
export const AI_INTENT_CLASSIFIED = 'AI_INTENT_CLASSIFIED';
export const AI_ESCALATED = 'AI_ESCALATED';
export const AI_KB_MATCHED = 'AI_KB_MATCHED';
export const AI_SETTINGS_UPDATE = 'AI_SETTINGS_UPDATE';
export const AI_KB_CREATED = 'AI_KB_CREATED';
export const AI_KB_UPDATED = 'AI_KB_UPDATED';
export const AI_KB_DELETED = 'AI_KB_DELETED';

/** Fase 11B — assist pipeline audit actions. */
export const AI_RESPONSE_GENERATED = 'AI_RESPONSE_GENERATED';
export const AI_KB_MATCH_FOUND = 'AI_KB_MATCH_FOUND';
export const AI_KB_MATCH_MISSED = 'AI_KB_MATCH_MISSED';

/** Fase 11C — AUTO supervised audit actions. */
export const AI_AUTO_SENT = 'AI_AUTO_SENT';
export const AI_AUTO_SKIPPED = 'AI_AUTO_SKIPPED';

/** Fase 11D — Recovery Engine. */
export const AI_RECOVERY_FOLLOWUP_TYPE = 'AI_RECOVERY' as const;
export const AI_RECOVERY_MESSAGE_SOURCE = 'ai_recovery' as const;
export const AI_RECOVERY_PIPELINE = 'recovery-11d';
export const AI_RECOVERY_PROMPT_VERSION = 'recovery-kb.v1';

export const AI_RECOVERY_CREATED = 'AI_RECOVERY_CREATED';
export const AI_RECOVERY_SENT = 'AI_RECOVERY_SENT';
export const AI_RECOVERY_STOPPED = 'AI_RECOVERY_STOPPED';
export const AI_RECOVERY_CONVERTED = 'AI_RECOVERY_CONVERTED';

/** Presets R1/R2/R3 — hours from campaign anchor. */
export const AI_RECOVERY_PRESETS = {
  R1: { key: 'R1', label: 'R1 · D+1', delayHours: 24 },
  R2: { key: 'R2', label: 'R2 · D+3', delayHours: 72 },
  R3: { key: 'R3', label: 'R3 · D+7', delayHours: 168 },
} as const;

export const AI_RECOVERY_DEFAULT_CADENCE_HOURS = [24, 72, 168] as const;
export const AI_RECOVERY_DEFAULT_MAX_ATTEMPTS = 3;
export const AI_RECOVERY_DEFAULT_COOLDOWN_HOURS = 24;
export const AI_RECOVERY_SCAN_LOCK_KEY = 'autopilot:recovery:scan';
export const AI_RECOVERY_SCAN_INTERVAL_MS = 60_000;
export const AI_RECOVERY_SCAN_BATCH = 40;
export const AI_RECOVERY_COMPANY_RATE_KEY_PREFIX =
  'autopilot:ai:recovery-rate:';
export const AI_RECOVERY_MAX_PER_COMPANY_PER_MINUTE = 10;

/** Fase 11E.1 — Sales Memory (Conversation.metadata.salesMemory). */
export const SALES_MEMORY_KEY = 'salesMemory' as const;
export const SALES_MEMORY_CREATED = 'SALES_MEMORY_CREATED';
export const SALES_MEMORY_UPDATED = 'SALES_MEMORY_UPDATED';
export const SALES_MEMORY_CLEARED = 'SALES_MEMORY_CLEARED';
export const SALES_MEMORY_SOURCE_MESSAGE_IDS_MAX = 20;
export const SALES_MEMORY_PRODUCT_INTEREST_MAX = 8;
export const SALES_MEMORY_BUDGET_MAX_CHARS = 80;
export const SALES_MEMORY_CITY_MAX_CHARS = 80;
export const SALES_MEMORY_SLOT_MAX_CHARS = 80;

/** Fase 11E.2 — Lead Scoring (deterministic, no OpenAI). */
export const LEAD_SCORE_UPDATED = 'LEAD_SCORE_UPDATED';
export const LEAD_BECAME_HOT = 'LEAD_BECAME_HOT';
export const LEAD_BECAME_WARM = 'LEAD_BECAME_WARM';
export const LEAD_BECAME_COLD = 'LEAD_BECAME_COLD';

/** Temperature bands (inclusive). */
export const LEAD_SCORE_COLD_MAX = 39;
export const LEAD_SCORE_WARM_MAX = 69;
/** HOT = 70–100 */

/** Fase 11E.3 — Objection Engine. */
export const OBJECTION_DETECTED = 'OBJECTION_DETECTED';
export const OBJECTION_HANDLED = 'OBJECTION_HANDLED';
export const OBJECTION_ESCALATED = 'OBJECTION_ESCALATED';
export const OBJECTION_HISTORY_MAX = 20;
/** Same type repeated ≥ this many times → escalate. */
export const OBJECTION_REPEAT_THRESHOLD = 2;
/** HOT lead with this many total objections and no purchase advance → escalate. */
export const OBJECTION_HOT_STALL_THRESHOLD = 2;
export const OBJECTION_PIPELINE = 'objection-11e3';
export const OBJECTION_PROMPT_VERSION = 'objection-kb.v1';
/** AUTO allowed only for these types (plus WARM/HOT temperature). */
export const OBJECTION_AUTO_TYPES = ['PRICE', 'TIME', 'TRUST'] as const;
export const OBJECTION_TYPES = [
  'PRICE',
  'TIME',
  'TRUST',
  'COMPARISON',
  'AUTHORITY',
  'NEED',
  'UNKNOWN',
] as const;

/** Fase 11E.4 — Next Best Action. */
export const NBA_DECIDED = 'NBA_DECIDED';
export const NBA_CHANGED = 'NBA_CHANGED';
export const NBA_EXECUTED = 'NBA_EXECUTED';
export const NBA_PIPELINE = 'nba-11e4';
/** Days without inbound reply before recommending SCHEDULE_RECOVERY. */
export const NBA_SILENCE_DAYS = 3;
export const NBA_ACTIONS = [
  'ASK_BUDGET',
  'ASK_CITY',
  'ASK_PAYMENT',
  'ASK_PRODUCT',
  'HANDLE_OBJECTION',
  'OFFER_ALTERNATIVE',
  'OFFER_CLOSE',
  'SCHEDULE_RECOVERY',
  'ESCALATE_HUMAN',
  'WAIT',
] as const;

/** Fase 11E.5 — Purchase Intent. */
export const PURCHASE_INTENT_CALCULATED = 'PURCHASE_INTENT_CALCULATED';
export const PURCHASE_INTENT_CHANGED = 'PURCHASE_INTENT_CHANGED';
export const PURCHASE_INTENT_HIGH = 'PURCHASE_INTENT_HIGH';
export const PURCHASE_INTENT_VERY_HIGH = 'PURCHASE_INTENT_VERY_HIGH';
export const PURCHASE_INTENT_PIPELINE = 'purchase-intent-11e5';
/** Bands (inclusive): VERY_LOW 0–24 · LOW 25–49 · MEDIUM 50–69 · HIGH 70–89 · VERY_HIGH 90–100 */
export const PURCHASE_INTENT_VERY_LOW_MAX = 24;
export const PURCHASE_INTENT_LOW_MAX = 49;
export const PURCHASE_INTENT_MEDIUM_MAX = 69;
export const PURCHASE_INTENT_HIGH_MAX = 89;
export const PURCHASE_INTENT_BANDS = [
  'VERY_LOW',
  'LOW',
  'MEDIUM',
  'HIGH',
  'VERY_HIGH',
] as const;
export const PURCHASE_INTENT_WEIGHTS = {
  temperatureHot: 22,
  temperatureWarm: 10,
  temperatureCold: -12,
  leadScoreFactor: 0.25,
  askedPrice: 10,
  askedPayment: 14,
  askedDelivery: 10,
  askedWarranty: 8,
  hasProduct: 12,
  hasBudget: 12,
  hasCity: 8,
  hasPaymentPref: 10,
  hasDeliveryPref: 8,
  slotPurchaseHigh: 12,
  slotPurchaseMedium: 6,
  nbaOfferClose: 10,
  nbaOfferAlternative: 4,
  fastReply: 8,
  noRecentObjection: 5,
  multiInboundPerExtra: 2,
  multiInboundCap: 8,
  closeReadyBonus: 18,
  leadLost: -50,
  complaintHistory: -28,
  authorityObjection: -18,
  repeatedObjections: -14,
  recoveryIgnored: -12,
  silence: -10,
  prolongedCooldown: -8,
  needObjection: -10,
} as const;
/** Default estimated ticket (BRL) when budget cannot be parsed. */
export const PURCHASE_INTENT_DEFAULT_TICKET = 500;

/**
 * Score weights (documented for 11E.2).
 * Positive signals add; negative subtract; final clamp 0–100.
 */
export const LEAD_SCORE_WEIGHTS = {
  askedProduct: 10,
  askedPrice: 8,
  hasBudget: 15,
  askedPayment: 12,
  askedDelivery: 6,
  hasCity: 6,
  urgencyHigh: 8,
  urgencyMedium: 4,
  purchaseIntentLow: 8,
  purchaseIntentMedium: 15,
  purchaseIntentHigh: 20,
  repliedRecovery: 10,
  multiInteractionPerExtra: 2,
  multiInteractionCap: 10,
  strongObjection: -12,
  softObjection: -8,
  leadLost: -40,
  inactivePerDayAfter2d: -3,
  inactiveCap: -20,
  unansweredOutbound: -8,
} as const;

export const AI_KB_BODY_MAX = 8000;
export const AI_KB_TITLE_MAX = 200;
export const AI_KB_PROMPT_BUDGET_CHARS = 8000;

/** Deterministic KB-grounded reply template. */
export const AI_ASSIST_PROMPT_VERSION = 'assist-kb.v1';
export const AI_ASSIST_MODEL = 'kb-template';
export const AI_ASSIST_PIPELINE = 'assist-11b';
export const AI_ASSIST_METADATA_MARKER = 'assist-11b' as const;

/** Message.metadata.source for AUTO outbound (11C). */
export const AI_AGENT_MESSAGE_SOURCE = 'ai_agent' as const;
export const AI_AUTO_PIPELINE = 'auto-11c';
export const AI_AUTO_PROMPT_VERSION = 'auto-kb.v1';

/** Guardrails AUTO (11C). */
export const AI_AUTO_MAX_PER_CONVERSATION = 8;
export const AI_AUTO_MAX_PER_COMPANY_PER_MINUTE = 20;
export const AI_AUTO_LEAD_COOLDOWN_SECONDS = 60;
export const AI_AUTO_MIN_CONFIDENCE = 0.55;
export const AI_AUTO_ANTI_LOOP_CONSECUTIVE = 2;
export const AI_AUTO_RATE_KEY_PREFIX = 'autopilot:ai:auto-rate:';

export function isAiFollowUpMetadata(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return false;
  }
  return (metadata as { source?: unknown }).source === AI_METADATA_SOURCE;
}
