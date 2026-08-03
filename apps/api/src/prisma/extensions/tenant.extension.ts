import { Prisma } from '@prisma/client';

/**
 * Scaffold — Tenant Prisma Extension (NOT activated).
 *
 * Future behavior:
 * - Require companyId on tenant-scoped reads/writes
 * - Reject cross-tenant where clauses
 * - Optionally inject companyId from TenantContext
 *
 * This file is intentionally inert: exporting helpers/types only.
 * Do NOT wire into PrismaService until explicitly approved.
 *
 * @see docs/tenant-safety.md
 * @see docs/prisma-extensions.md
 */

/** Models that MUST be scoped by companyId (D10). */
export const TENANT_SCOPED_MODELS = [
  'membership',
  'lead',
  'conversation',
  'message',
  'followUp',
  'event',
  'auditLog',
] as const;

export type TenantScopedModel = (typeof TENANT_SCOPED_MODELS)[number];

/** Models outside tenant ownership. */
export const GLOBAL_MODELS = ['company', 'user'] as const;

export type TenantExtensionOptions = {
  /**
   * Resolved tenant for the current request/job.
   * Undefined means "no tenant context" — future extension should fail closed
   * on tenant-scoped operations when enforce is true.
   */
  companyId?: string;
  /** When true, missing companyId on tenant ops throws. Default future: true. */
  enforce?: boolean;
};

/**
 * Placeholder factory for the future Prisma Client Extension.
 * Returns an empty extension object so the module typechecks without
 * changing PrismaClient behavior.
 */
export function createTenantExtension(_options: TenantExtensionOptions = {}) {
  // Intentionally empty — activation deferred.
  // Future: Prisma.defineExtension({ query: { ... } })
  return Prisma.defineExtension({
    name: 'autopilot-tenant-scaffold',
    // No query/model overrides yet.
  });
}

/**
 * Static helper for application services (usable before extension activation).
 * Validates that a payload/where companyId matches the active tenant.
 */
export function assertSameTenant(
  expectedCompanyId: string | undefined,
  actualCompanyId: string | undefined,
  context = 'tenant-check',
): void {
  if (!expectedCompanyId) {
    throw new Error(`[${context}] Missing expected companyId (tenant context).`);
  }
  if (!actualCompanyId) {
    throw new Error(`[${context}] Missing actual companyId on entity/input.`);
  }
  if (expectedCompanyId !== actualCompanyId) {
    throw new Error(
      `[${context}] Cross-tenant violation: expected=${expectedCompanyId} actual=${actualCompanyId}`,
    );
  }
}
