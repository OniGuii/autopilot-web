import { AsyncLocalStorage } from 'async_hooks';

/**
 * 8B — RLS session flags (complement tenant ALS companyId).
 * Bypass is for migrations/seeds/system scanners only.
 */
const rlsBypassAls = new AsyncLocalStorage<boolean>();
const rlsTxDepthAls = new AsyncLocalStorage<number>();

export function isRlsBypass(): boolean {
  return rlsBypassAls.getStore() === true;
}

export function runWithRlsBypass<T>(fn: () => T): T {
  return rlsBypassAls.run(true, fn);
}

export async function runWithRlsBypassAsync<T>(
  fn: () => Promise<T>,
): Promise<T> {
  return rlsBypassAls.run(true, fn);
}

export function getRlsTxDepth(): number {
  return rlsTxDepthAls.getStore() ?? 0;
}

export function runWithRlsTxDepth<T>(depth: number, fn: () => T): T {
  return rlsTxDepthAls.run(depth, fn);
}
