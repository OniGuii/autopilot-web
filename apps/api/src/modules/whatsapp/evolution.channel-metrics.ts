import { Injectable } from '@nestjs/common';
import type { CircuitState, EvolutionErrorClass } from './evolution.constants';

type TimedSample = { at: number; ms: number };

/**
 * In-memory channel metrics for Ops (6B — no Prometheus exporter yet).
 */
@Injectable()
export class EvolutionChannelMetrics {
  private requestsTotal = 0;
  private retriesTotal = 0;
  private byResult = new Map<string, number>();
  private timeouts: number[] = [];
  private requestDurations: TimedSample[] = [];
  private webhookDurations: TimedSample[] = [];
  private webhookSlow: number[] = [];
  private webhookInflight = 0;
  private connectionFlaps = 0;
  private lastErrorAt: number | null = null;
  private circuitState: CircuitState = 'CLOSED';

  recordRequest(
    result: string,
    durationMs: number,
    errorClass?: EvolutionErrorClass,
  ): void {
    this.requestsTotal += 1;
    const key = result;
    this.byResult.set(key, (this.byResult.get(key) ?? 0) + 1);
    if (Number.isFinite(durationMs) && durationMs >= 0) {
      this.requestDurations.push({ at: Date.now(), ms: durationMs });
      this.trimSamples(this.requestDurations);
    }
    if (errorClass === 'TIMEOUT' || result === 'timeout') {
      this.timeouts.push(Date.now());
      this.trim(this.timeouts);
    }
    if (errorClass && errorClass !== 'CIRCUIT_OPEN') {
      this.lastErrorAt = Date.now();
    }
  }

  recordRetry(): void {
    this.retriesTotal += 1;
  }

  setCircuitState(state: CircuitState): void {
    this.circuitState = state;
  }

  recordWebhook(durationMs: number, slowMs: number): void {
    const now = Date.now();
    this.webhookDurations.push({ at: now, ms: durationMs });
    this.trimSamples(this.webhookDurations);
    if (durationMs >= slowMs) {
      this.webhookSlow.push(now);
      this.trim(this.webhookSlow);
    }
  }

  beginWebhook(): boolean {
    this.webhookInflight += 1;
    return true;
  }

  endWebhook(): void {
    this.webhookInflight = Math.max(0, this.webhookInflight - 1);
  }

  recordConnectionFlap(): void {
    this.connectionFlaps += 1;
  }

  snapshot(input?: { circuitState?: CircuitState }): {
    evolutionCircuitState: CircuitState;
    evolutionRequestsTotal: number;
    evolutionRetriesTotal: number;
    evolutionTimeoutsLast15m: number;
    evolutionLastErrorAt: string | null;
    webhookInflight: number;
    webhookP95Ms: number | null;
    requestP95Ms: number | null;
    webhookSlowLast15m: number;
    connectionFlaps: number;
    byResult: Record<string, number>;
  } {
    const state = input?.circuitState ?? this.circuitState;
    return {
      evolutionCircuitState: state,
      evolutionRequestsTotal: this.requestsTotal,
      evolutionRetriesTotal: this.retriesTotal,
      evolutionTimeoutsLast15m: this.countSince(this.timeouts, 15 * 60_000),
      evolutionLastErrorAt: this.lastErrorAt
        ? new Date(this.lastErrorAt).toISOString()
        : null,
      webhookInflight: this.webhookInflight,
      webhookP95Ms: this.percentile(
        this.webhookDurations.map((s) => s.ms),
        0.95,
      ),
      requestP95Ms: this.percentile(
        this.requestDurations.map((s) => s.ms),
        0.95,
      ),
      webhookSlowLast15m: this.countSince(this.webhookSlow, 15 * 60_000),
      connectionFlaps: this.connectionFlaps,
      byResult: Object.fromEntries(this.byResult.entries()),
    };
  }

  private countSince(timestamps: number[], windowMs: number): number {
    const cutoff = Date.now() - windowMs;
    return timestamps.filter((t) => t >= cutoff).length;
  }

  private trim(timestamps: number[]): void {
    const cutoff = Date.now() - 15 * 60_000;
    while (timestamps.length && timestamps[0] < cutoff) {
      timestamps.shift();
    }
  }

  private trimSamples(samples: TimedSample[]): void {
    const cutoff = Date.now() - 15 * 60_000;
    while (samples.length && samples[0].at < cutoff) {
      samples.shift();
    }
    if (samples.length > 500) {
      samples.splice(0, samples.length - 500);
    }
  }

  private percentile(values: number[], p: number): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.min(
      sorted.length - 1,
      Math.max(0, Math.ceil(p * sorted.length) - 1),
    );
    return sorted[idx] ?? null;
  }
}
