import { AsyncLocalStorage } from 'async_hooks';

export type TenantAlsStore = {
  companyId?: string;
};

/**
 * Request-scoped tenant storage for Prisma tenant extension.
 * Populated by TenantInterceptor from JWT.cid when present.
 */
export const tenantAls = new AsyncLocalStorage<TenantAlsStore>();

export function getTenantCompanyId(): string | undefined {
  return tenantAls.getStore()?.companyId;
}

export function runWithTenant<T>(
  companyId: string | undefined,
  fn: () => T,
): T {
  return tenantAls.run({ companyId }, fn);
}
