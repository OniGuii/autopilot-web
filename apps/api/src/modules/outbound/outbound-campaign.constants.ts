/** Outbound V1.4A — Campaign MVP */

export const OUTBOUND_CAMPAIGN_PIPELINE = 'outbound_campaign_v1_4a' as const;

export const CAMPAIGN_STATUSES = {
  DRAFT: 'DRAFT',
  READY: 'READY',
  RUNNING: 'RUNNING',
  PAUSED: 'PAUSED',
  COMPLETED: 'COMPLETED',
  ARCHIVED: 'ARCHIVED',
} as const;

export type CampaignStatus =
  (typeof CAMPAIGN_STATUSES)[keyof typeof CAMPAIGN_STATUSES];

/** Audits (product names) */
export const CAMPAIGN_CREATED = 'CAMPAIGN_CREATED';
export const CAMPAIGN_UPDATED = 'CAMPAIGN_UPDATED';
export const CAMPAIGN_STARTED = 'CAMPAIGN_STARTED';
export const CAMPAIGN_PAUSED = 'CAMPAIGN_PAUSED';
export const CAMPAIGN_COMPLETED = 'CAMPAIGN_COMPLETED';
export const CAMPAIGN_ARCHIVED = 'CAMPAIGN_ARCHIVED';
export const CAMPAIGN_LEADS_ADDED = 'CAMPAIGN_LEADS_ADDED';
export const CAMPAIGN_LEADS_REMOVED = 'CAMPAIGN_LEADS_REMOVED';

/** HOT threshold aligned with Sales Brain 11E.2 */
export const CAMPAIGN_HOT_SCORE_THRESHOLD = 70;

export const CAMPAIGN_ADD_LEADS_MAX = 500;
