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

export function isAiFollowUpMetadata(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return false;
  }
  return (metadata as { source?: unknown }).source === AI_METADATA_SOURCE;
}
