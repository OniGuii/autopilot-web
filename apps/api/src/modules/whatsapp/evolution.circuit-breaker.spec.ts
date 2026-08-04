import { EvolutionCircuitBreaker } from './evolution.circuit-breaker';

describe('EvolutionCircuitBreaker', () => {
  it('opens after failure threshold and allows half-open after openMs', () => {
    let now = 1_000;
    const cb = new EvolutionCircuitBreaker({
      failureThreshold: 2,
      successThreshold: 1,
      openMs: 100,
      halfOpenMaxCalls: 1,
      now: () => now,
    });

    expect(cb.allowRequest()).toBe(true);
    cb.recordFailure();
    expect(cb.getState()).toBe('CLOSED');
    expect(cb.allowRequest()).toBe(true);
    cb.recordFailure();
    expect(cb.getState()).toBe('OPEN');
    expect(cb.allowRequest()).toBe(false);

    now += 100;
    expect(cb.getState()).toBe('HALF_OPEN');
    expect(cb.allowRequest()).toBe(true);
    expect(cb.allowRequest()).toBe(false); // max probes

    cb.recordSuccess();
    expect(cb.getState()).toBe('CLOSED');
  });

  it('returns to OPEN on half-open failure', () => {
    let now = 0;
    const cb = new EvolutionCircuitBreaker({
      failureThreshold: 1,
      successThreshold: 2,
      openMs: 10,
      halfOpenMaxCalls: 1,
      now: () => now,
    });
    cb.recordFailure();
    expect(cb.getState()).toBe('OPEN');
    now += 10;
    expect(cb.allowRequest()).toBe(true);
    cb.recordFailure();
    expect(cb.getState()).toBe('OPEN');
  });
});
