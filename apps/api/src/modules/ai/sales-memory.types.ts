/** Fase 11E.1 — commercial memory slots (Conversation.metadata.salesMemory). */

export type SalesUrgency = 'LOW' | 'MEDIUM' | 'HIGH';

export type SalesPurchaseIntentLevel = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';

export type SalesObjectionCode =
  | 'CARO'
  | 'SEM_TEMPO'
  | 'PRECISO_PENSAR'
  | 'VER_COM_SOCIO'
  | 'COMPARANDO_CONCORRENTE';

export type SalesMemorySlots = {
  budget: string | null;
  productInterest: string[];
  city: string | null;
  urgency: SalesUrgency | null;
  paymentPreference: string | null;
  deliveryPreference: string | null;
  lastObjection: SalesObjectionCode | null;
  purchaseIntentLevel: SalesPurchaseIntentLevel;
};

export type SalesMemory = SalesMemorySlots & {
  version: number;
  updatedAt: string;
  sourceMessageIds: string[];
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
  | 'purchaseIntentLevel';

export type SalesMemoryMergeResult = {
  memory: SalesMemory;
  created: boolean;
  changed: boolean;
  fieldsDetected: SalesMemoryField[];
  conflicts: SalesMemoryField[];
};
