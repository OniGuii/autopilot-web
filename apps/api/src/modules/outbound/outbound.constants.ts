/** Outbound V1.1 — Protection Layer */

export const OUTBOUND_PROTECTION_PIPELINE = 'outbound_protection_v1_1' as const;

/** Message.metadata.source values gated as proactive outbound. */
export const OUTBOUND_PROACTIVE_SOURCES = [
  'ai_recovery',
  'outbound_first_touch',
  'outbound_nurture',
] as const;

export type OutboundProactiveSource =
  (typeof OUTBOUND_PROACTIVE_SOURCES)[number];

export const OUTBOUND_DEFAULT_DAILY_CAP = 50;
export const OUTBOUND_DEFAULT_HOURLY_CAP = 15;
export const OUTBOUND_DEFAULT_LEAD_COOLDOWN_MINUTES = 60;
export const OUTBOUND_DEFAULT_MIN_SPACING_SECONDS = 30;
export const OUTBOUND_DEFAULT_SUPPRESS_KEYWORDS = [
  'pare',
  'stop',
  'sair',
  'cancelar',
] as const;

export const OUTBOUND_SUPPRESS_SOURCES = {
  MANUAL: 'MANUAL',
  KEYWORD: 'KEYWORD',
  LOST: 'LOST',
  IMPORT: 'IMPORT',
  SYSTEM: 'SYSTEM',
} as const;

export type OutboundSuppressSource =
  (typeof OUTBOUND_SUPPRESS_SOURCES)[keyof typeof OUTBOUND_SUPPRESS_SOURCES];

/** Audit actions */
export const OUTBOUND_PROTECTION_UPDATED = 'OUTBOUND_PROTECTION_UPDATED';
export const OUTBOUND_SUPPRESS_ADDED = 'OUTBOUND_SUPPRESS_ADDED';
export const OUTBOUND_SUPPRESS_REMOVED = 'OUTBOUND_SUPPRESS_REMOVED';
export const OUTBOUND_PROACTIVE_BLOCKED = 'OUTBOUND_PROACTIVE_BLOCKED';
export const OUTBOUND_OPT_OUT = 'OUTBOUND_OPT_OUT';

export const OUTBOUND_BLOCK_REASONS = {
  SUPPRESSED: 'SUPPRESSED',
  LEAD_LOST: 'LEAD_LOST',
  LEAD_CONVERTED: 'LEAD_CONVERTED',
  DAILY_CAP: 'DAILY_CAP',
  HOURLY_CAP: 'HOURLY_CAP',
  LEAD_COOLDOWN: 'LEAD_COOLDOWN',
  MIN_SPACING: 'MIN_SPACING',
  OUTSIDE_ALLOWED_HOURS: 'OUTSIDE_ALLOWED_HOURS',
  PROTECTION_DISABLED_SKIP_CAPS: 'PROTECTION_DISABLED_SKIP_CAPS',
} as const;

export type OutboundBlockReason =
  (typeof OUTBOUND_BLOCK_REASONS)[keyof typeof OUTBOUND_BLOCK_REASONS];

export function isProactiveOutboundSource(source: string): boolean {
  return (OUTBOUND_PROACTIVE_SOURCES as readonly string[]).includes(source);
}
