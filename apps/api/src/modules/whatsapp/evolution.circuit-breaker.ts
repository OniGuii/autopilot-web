import type { CircuitState } from './evolution.constants';

export type CircuitBreakerOptions = {
  failureThreshold: number;
  successThreshold: number;
  openMs: number;
  halfOpenMaxCalls: number;
  now?: () => number;
};

export type CircuitSnapshot = {
  state: CircuitState;
  consecutiveFailures: number;
  openedAt: number | null;
  lastErrorAt: number | null;
  transitions: number;
};

/**
 * In-memory circuit breaker (CH4 / P6B-4). Process-local per réplica.
 */
export class EvolutionCircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private openedAt: number | null = null;
  private lastErrorAt: number | null = null;
  private halfOpenInFlight = 0;
  private transitions = 0;
  private readonly now: () => number;

  constructor(private readonly opts: CircuitBreakerOptions) {
    this.now = opts.now ?? Date.now;
  }

  getState(): CircuitState {
    this.maybeTransitionFromOpen();
    return this.state;
  }

  snapshot(): CircuitSnapshot {
    this.maybeTransitionFromOpen();
    return {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      openedAt: this.openedAt,
      lastErrorAt: this.lastErrorAt,
      transitions: this.transitions,
    };
  }

  /** Returns false when call should fail-fast. */
  allowRequest(): boolean {
    this.maybeTransitionFromOpen();
    if (this.state === 'OPEN') return false;
    if (this.state === 'HALF_OPEN') {
      if (this.halfOpenInFlight >= this.opts.halfOpenMaxCalls) return false;
      this.halfOpenInFlight += 1;
      return true;
    }
    return true;
  }

  recordSuccess(): void {
    this.releaseHalfOpenSlot();
    if (this.state === 'HALF_OPEN') {
      this.consecutiveSuccesses += 1;
      if (this.consecutiveSuccesses >= this.opts.successThreshold) {
        this.transition('CLOSED');
        this.consecutiveFailures = 0;
        this.consecutiveSuccesses = 0;
        this.openedAt = null;
      }
      return;
    }
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
  }

  recordFailure(): void {
    this.lastErrorAt = this.now();
    this.releaseHalfOpenSlot();
    if (this.state === 'HALF_OPEN') {
      this.transition('OPEN');
      this.openedAt = this.now();
      this.consecutiveSuccesses = 0;
      this.consecutiveFailures = this.opts.failureThreshold;
      return;
    }
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.opts.failureThreshold) {
      this.transition('OPEN');
      this.openedAt = this.now();
    }
  }

  /** Release HALF_OPEN probe without counting success/failure (e.g. 4xx). */
  releaseHalfOpenSlot(): void {
    if (this.state === 'HALF_OPEN' || this.halfOpenInFlight > 0) {
      this.halfOpenInFlight = Math.max(0, this.halfOpenInFlight - 1);
    }
  }

  /** Test helper */
  forceOpen(): void {
    this.transition('OPEN');
    this.openedAt = this.now();
    this.consecutiveFailures = this.opts.failureThreshold;
  }

  forceClosed(): void {
    this.transition('CLOSED');
    this.openedAt = null;
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.halfOpenInFlight = 0;
  }

  private maybeTransitionFromOpen(): void {
    if (this.state !== 'OPEN' || this.openedAt === null) return;
    if (this.now() - this.openedAt >= this.opts.openMs) {
      this.transition('HALF_OPEN');
      this.consecutiveSuccesses = 0;
      this.halfOpenInFlight = 0;
    }
  }

  private transition(next: CircuitState): void {
    if (this.state === next) return;
    this.state = next;
    this.transitions += 1;
  }
}
