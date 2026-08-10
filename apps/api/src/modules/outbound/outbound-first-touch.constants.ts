/** Outbound V1.3 — First Touch Engine */

export const OUTBOUND_FIRST_TOUCH_PIPELINE = 'outbound_first_touch_v1_3' as const;

export const OUTBOUND_FIRST_TOUCH_FOLLOWUP_TYPE = 'OUTBOUND_FIRST_TOUCH';
export const OUTBOUND_FIRST_TOUCH_MESSAGE_SOURCE = 'outbound_first_touch';

export const FIRST_TOUCH_MODES = {
  OFF: 'OFF',
  HUMAN_APPROVE: 'HUMAN_APPROVE',
  AUTO_SEND: 'AUTO_SEND',
} as const;

export type FirstTouchMode =
  (typeof FIRST_TOUCH_MODES)[keyof typeof FIRST_TOUCH_MODES];

export const FIRST_TOUCH_PLAYBOOKS = {
  GENERIC: 'generic',
  FINANCEIRA: 'financeira',
  IMOBILIARIA: 'imobiliaria',
  SOLAR: 'solar',
  ECOMMERCE: 'ecommerce',
} as const;

export type FirstTouchPlaybook =
  (typeof FIRST_TOUCH_PLAYBOOKS)[keyof typeof FIRST_TOUCH_PLAYBOOKS];

export const FIRST_TOUCH_DEFAULT_MAX_BATCH = 50;
export const FIRST_TOUCH_MAX_BODY_CHARS = 500;

/** Audits (product names) */
export const FIRST_TOUCH_CREATED = 'FIRST_TOUCH_CREATED';
export const FIRST_TOUCH_APPROVED = 'FIRST_TOUCH_APPROVED';
export const FIRST_TOUCH_SENT = 'FIRST_TOUCH_SENT';
export const FIRST_TOUCH_FAILED = 'FIRST_TOUCH_FAILED';
export const FIRST_TOUCH_SETTINGS_UPDATED = 'FIRST_TOUCH_SETTINGS_UPDATED';
export const FIRST_TOUCH_REJECTED = 'FIRST_TOUCH_REJECTED';

export const FIRST_TOUCH_PENDING_STATUSES = [
  'SUGGESTED',
  'SCHEDULED',
  'EXECUTING',
] as const;

export const FIRST_TOUCH_BLOCKING_STATUSES = [
  'SUGGESTED',
  'SCHEDULED',
  'EXECUTING',
  'EXECUTED',
] as const;
