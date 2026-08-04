import { AsyncLocalStorage } from 'async_hooks';
import {
  getRequestContext,
  getTenantCompanyId as getCompanyIdFromContext,
  requestContextAls,
  runWithRequestContext,
  type RequestContextStore,
} from '../../observability/request-context';

/**
 * Back-compat tenant ALS API.
 * Storage is shared with observability request context (8A).
 */
export type TenantAlsStore = RequestContextStore;

/** @deprecated Use requestContextAls — alias kept for existing imports. */
export const tenantAls: AsyncLocalStorage<TenantAlsStore> = requestContextAls;

export function getTenantCompanyId(): string | undefined {
  return getCompanyIdFromContext();
}

/** Historical signature: runWithTenant(companyId, fn). */
export function runWithTenant<T>(
  companyId: string | undefined,
  fn: () => T,
): T {
  return runWithRequestContext({ companyId }, fn);
}

export { getRequestContext, runWithRequestContext };
