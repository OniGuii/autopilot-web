/** Outbound V1.2 — Lead Import Engine */

export const OUTBOUND_IMPORT_PIPELINE = 'outbound_import_v1_2' as const;

export const OUTBOUND_IMPORT_MAX_ROWS = 500;
export const OUTBOUND_IMPORT_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
export const OUTBOUND_IMPORT_PREVIEW_ROWS = 20;
export const OUTBOUND_IMPORT_DEFAULT_SOURCE = 'OUTBOUND_IMPORT';

export const OUTBOUND_IMPORT_STATUSES = {
  UPLOADED: 'UPLOADED',
  MAPPING: 'MAPPING',
  VALIDATED: 'VALIDATED',
  COMMITTING: 'COMMITTING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const;

export type OutboundImportStatus =
  (typeof OUTBOUND_IMPORT_STATUSES)[keyof typeof OUTBOUND_IMPORT_STATUSES];

export const OUTBOUND_IMPORT_KINDS = {
  CSV: 'CSV',
  XLSX: 'XLSX',
  PASTE: 'PASTE',
} as const;

export type OutboundImportKind =
  (typeof OUTBOUND_IMPORT_KINDS)[keyof typeof OUTBOUND_IMPORT_KINDS];

export const OUTBOUND_IMPORT_DEDUPE_MODES = {
  SKIP: 'skip',
  REJECT: 'reject',
} as const;

/** Target fields for column mapping */
export const OUTBOUND_IMPORT_TARGET_FIELDS = [
  'phone',
  'name',
  'email',
  'externalId',
  'source',
  'city',
  'product',
  'value',
  'notes',
] as const;

export type OutboundImportTargetField =
  (typeof OUTBOUND_IMPORT_TARGET_FIELDS)[number];

/** Fields that land in Lead.metadata (not first-class columns). */
export const OUTBOUND_IMPORT_METADATA_FIELDS = [
  'city',
  'product',
  'value',
  'notes',
] as const;

export const OUTBOUND_IMPORT_CREATED = 'OUTBOUND_IMPORT_CREATED';
export const OUTBOUND_IMPORT_MAPPING_UPDATED =
  'OUTBOUND_IMPORT_MAPPING_UPDATED';
export const OUTBOUND_IMPORT_VALIDATED = 'OUTBOUND_IMPORT_VALIDATED';
export const OUTBOUND_IMPORT_COMMITTED = 'OUTBOUND_IMPORT_COMMITTED';
export const OUTBOUND_IMPORT_CANCELLED = 'OUTBOUND_IMPORT_CANCELLED';
export const OUTBOUND_IMPORT_FAILED = 'OUTBOUND_IMPORT_FAILED';

/** Header aliases → target field (lowercase, accent-stripped match). */
export const OUTBOUND_IMPORT_HEADER_ALIASES: Record<
  string,
  OutboundImportTargetField
> = {
  telefone: 'phone',
  phone: 'phone',
  celular: 'phone',
  whatsapp: 'phone',
  fone: 'phone',
  nome: 'name',
  name: 'name',
  email: 'email',
  e_mail: 'email',
  cidade: 'city',
  city: 'city',
  produto: 'product',
  product: 'product',
  interesse: 'product',
  valor: 'value',
  value: 'value',
  ticket: 'value',
  origem: 'source',
  source: 'source',
  fonte: 'source',
  observacao: 'notes',
  observações: 'notes',
  observacoes: 'notes',
  notes: 'notes',
  obs: 'notes',
  external_id: 'externalId',
  externalid: 'externalId',
  id_externo: 'externalId',
};
