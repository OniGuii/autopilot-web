/** Fase 11E.1 — commercial memory slots (Conversation.metadata.salesMemory). */

export type SalesUrgency = 'LOW' | 'MEDIUM' | 'HIGH';

export type SalesPurchaseIntentLevel = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';

/** Fase 11E.3 — commercial objection catalog. */
export type SalesObjectionCode =
  'PRICE' | 'TIME' | 'TRUST' | 'COMPARISON' | 'AUTHORITY' | 'NEED' | 'UNKNOWN';

export type SalesTemperature = 'COLD' | 'WARM' | 'HOT';

/** Append-only history of detected objections (11E.3). */
export type ObjectionHistoryEntry = {
  type: SalesObjectionCode;
  at: string;
  messageId?: string;
};

export type SalesMemorySlots = {
  budget: string | null;
  productInterest: string[];
  city: string | null;
  urgency: SalesUrgency | null;
  paymentPreference: string | null;
  deliveryPreference: string | null;
  lastObjection: SalesObjectionCode | null;
  /** Fase 11E.3 — chronological objection events. */
  objectionHistory: ObjectionHistoryEntry[];
  purchaseIntentLevel: SalesPurchaseIntentLevel;
};

export type SalesMemory = SalesMemorySlots & {
  version: number;
  updatedAt: string;
  sourceMessageIds: string[];
  /** Fase 11E.2 — deterministic commercial score 0–100. */
  score: number;
  temperature: SalesTemperature;
  lastScoreAt: string | null;
};

/** Partial patch from rule extractor — only set fields that were detected. */
export type SalesMemoryPatch = Partial<{
  budget: string;
  productInterest: string[];
  city: string;
  urgency: SalesUrgency;
  paymentPreference: string;
  deliveryPreference: string;
  lastObjection: SalesObjectionCode;
  objectionHistory: ObjectionHistoryEntry[];
  purchaseIntentLevel: SalesPurchaseIntentLevel;
}>;

export type SalesMemoryField =
  | 'budget'
  | 'productInterest'
  | 'city'
  | 'urgency'
  | 'paymentPreference'
  | 'deliveryPreference'
  | 'lastObjection'
  | 'objectionHistory'
  | 'purchaseIntentLevel';

export type SalesMemoryMergeResult = {
  memory: SalesMemory;
  created: boolean;
  changed: boolean;
  fieldsDetected: SalesMemoryField[];
  conflicts: SalesMemoryField[];
};
