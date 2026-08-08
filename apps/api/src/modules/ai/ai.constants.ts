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
