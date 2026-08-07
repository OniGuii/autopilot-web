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

export const AI_KB_BODY_MAX = 8000;
export const AI_KB_TITLE_MAX = 200;
export const AI_KB_PROMPT_BUDGET_CHARS = 8000;

/** Deterministic KB-grounded reply template (no OpenAI / no auto-send). */
export const AI_ASSIST_PROMPT_VERSION = 'assist-kb.v1';
export const AI_ASSIST_MODEL = 'kb-template';
export const AI_ASSIST_PIPELINE = 'assist-11b';
export const AI_ASSIST_METADATA_MARKER = 'assist-11b' as const;

export function isAiFollowUpMetadata(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return false;
  }
  return (metadata as { source?: unknown }).source === AI_METADATA_SOURCE;
}
