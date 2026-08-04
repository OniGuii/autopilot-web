import { AsyncLocalStorage } from 'async_hooks';

/**
 * Request / job scoped context for logs, audit, metrics and OTEL attributes.
 * Extends the historical tenant ALS with correlation + actor fields (8A).
 */
export type RequestContextStore = {
  companyId?: string;
  correlationId?: string;
  userId?: string;
  module?: string;
};

export const requestContextAls = new AsyncLocalStorage<RequestContextStore>();

export function getRequestContext(): RequestContextStore {
  return requestContextAls.getStore() ?? {};
}

export function getCorrelationId(): string | undefined {
  return requestContextAls.getStore()?.correlationId;
}

export function getTenantCompanyId(): string | undefined {
  return requestContextAls.getStore()?.companyId;
}

export function runWithRequestContext<T>(
  patch: RequestContextStore,
  fn: () => T,
): T {
  const prev = requestContextAls.getStore() ?? {};
  return requestContextAls.run({ ...prev, ...patch }, fn);
}

export async function runWithRequestContextAsync<T>(
  patch: RequestContextStore,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = requestContextAls.getStore() ?? {};
  return requestContextAls.run({ ...prev, ...patch }, fn);
}
