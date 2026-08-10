import { Prisma } from '@prisma/client';

/**
 * Soft Delete Prisma Extension (activated).
 *
 * - findMany / findFirst / count / aggregate / groupBy → deletedAt: null (unless overridden)
 * - findUnique → hides soft-deleted rows (post-filter)
 *
 * Note: delete→update rewrite stays in the application layer (services already
 * soft-delete via update). Extension focuses on read-path isolation.
 */

export const SOFT_DELETE_MODELS = [
  'company',
  'user',
  'membership',
  'session',
  'refreshToken',
  'lead',
  'conversation',
  'message',
  'followUp',
  'event',
  'auditLog',
  'whatsAppInstance',
  'webhookEvent',
  'leadNote',
  'leadActivity',
  'companyAiSettings',
  'knowledgeBaseEntry',
  'companyRecoverySettings',
  'companyOutboundProtectionSettings',
  'outboundSuppressEntry',
] as const;

export type SoftDeleteModel = (typeof SOFT_DELETE_MODELS)[number];

const SOFT_DELETE_MODEL_SET = new Set<string>(SOFT_DELETE_MODELS);

export type SoftDeleteExtensionOptions = {
  filterDeleted?: boolean;
  /** Kept for API compatibility; rewrite is handled in services. */
  rewriteDelete?: boolean;
};

function isSoftDeleteModel(model: string): boolean {
  return SOFT_DELETE_MODEL_SET.has(model);
}

function withNotDeleted(
  where: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (where && Object.prototype.hasOwnProperty.call(where, 'deletedAt')) {
    return where;
  }
  return { ...(where ?? {}), deletedAt: null };
}

type QueryArgs = {
  model: string;
  args: {
    where?: Record<string, unknown>;
    [key: string]: unknown;
  };
  query: (args: unknown) => Promise<unknown>;
};

export function createSoftDeleteExtension(
  options: SoftDeleteExtensionOptions = {},
) {
  const filterDeleted = options.filterDeleted !== false;

  const handlers = {
    async findMany({ model, args, query }: QueryArgs) {
      if (filterDeleted && isSoftDeleteModel(model)) {
        args = { ...args, where: withNotDeleted(args.where) };
      }
      return query(args);
    },
    async findFirst({ model, args, query }: QueryArgs) {
      if (filterDeleted && isSoftDeleteModel(model)) {
        args = { ...args, where: withNotDeleted(args.where) };
      }
      return query(args);
    },
    async findUnique({ model, args, query }: QueryArgs) {
      const result = await query(args);
      if (
        filterDeleted &&
        isSoftDeleteModel(model) &&
        result &&
        typeof result === 'object' &&
        'deletedAt' in result &&
        result.deletedAt != null
      ) {
        return null;
      }
      return result;
    },
    async count({ model, args, query }: QueryArgs) {
      if (filterDeleted && isSoftDeleteModel(model)) {
        args = { ...args, where: withNotDeleted(args.where) };
      }
      return query(args);
    },
    async aggregate({ model, args, query }: QueryArgs) {
      if (filterDeleted && isSoftDeleteModel(model)) {
        args = { ...args, where: withNotDeleted(args.where) };
      }
      return query(args);
    },
    async groupBy({ model, args, query }: QueryArgs) {
      if (filterDeleted && isSoftDeleteModel(model)) {
        args = { ...args, where: withNotDeleted(args.where) };
      }
      return query(args);
    },
  };

  return Prisma.defineExtension({
    name: 'autopilot-soft-delete',
    query: {
      $allModels: handlers,
    },
  });
}

export function notDeletedWhere<T extends Record<string, unknown>>(
  where?: T,
): T & { deletedAt: null } {
  return withNotDeleted(where) as T & { deletedAt: null };
}
