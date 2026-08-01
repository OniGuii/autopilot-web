import { Prisma } from '@prisma/client';

/**
 * Scaffold — Soft Delete Prisma Extension (NOT activated).
 *
 * Future behavior:
 * - Auto-filter deletedAt: null on find* queries
 * - Map delete → update { deletedAt: now() }
 * - Provide explicit includeDeleted / hardDelete escapes (restricted)
 *
 * This file is intentionally inert regarding runtime behavior until wired
 * into PrismaService with approval.
 *
 * @see docs/database-principles.md
 * @see docs/prisma-extensions.md
 */

/** All persisted models currently expose deletedAt. */
export const SOFT_DELETE_MODELS = [
  'company',
  'user',
  'membership',
  'lead',
  'conversation',
  'message',
  'followUp',
  'event',
  'auditLog',
] as const;

export type SoftDeleteModel = (typeof SOFT_DELETE_MODELS)[number];

export type SoftDeleteExtensionOptions = {
  /** When true, find queries exclude soft-deleted rows. Future default: true. */
  filterDeleted?: boolean;
  /**
   * When true, prisma.*.delete becomes soft delete.
   * Future default: true (hard delete forbidden in MVP app layer).
   */
  rewriteDelete?: boolean;
};

/**
 * Placeholder factory for the future soft-delete extension.
 * Empty extension — does not alter PrismaClient until activated.
 */
export function createSoftDeleteExtension(
  _options: SoftDeleteExtensionOptions = {},
) {
  // Intentionally empty — activation deferred.
  return Prisma.defineExtension({
    name: 'autopilot-soft-delete-scaffold',
    // No query/model overrides yet.
  });
}

/** Pure helper for services until the extension is active. */
export function notDeletedWhere<T extends Record<string, unknown>>(
  where?: T,
): T & { deletedAt: null } {
  return {
    ...(where ?? ({} as T)),
    deletedAt: null,
  };
}
