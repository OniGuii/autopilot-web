import { AsyncMetricsService } from './async-metrics.service';

describe('AsyncMetricsService', () => {
  it('returns available=false without inventing zero queue depths', async () => {
    const inbound = {
      getJobCounts: jest.fn().mockRejectedValue(new Error('redis down')),
    };
    const dlq = {
      cleanup: jest.fn().mockResolvedValue(undefined),
      getMetrics: jest.fn(),
    };
    const service = new AsyncMetricsService(
      inbound as never,
      {} as never,
      dlq as never,
    );

    const snap = await service.snapshot();
    expect(snap.available).toBe(false);
    expect(snap.whatsappInbound).toBeNull();
    expect(snap.dlqWhatsappInbound).toBeNull();
    expect(snap.dlq).toBeNull();
    expect(snap.error).toContain('redis down');
  });

  it('exposes processing counters and p95', async () => {
    const inbound = {
      getJobCounts: jest.fn().mockResolvedValue({
        waiting: 1,
        active: 0,
        completed: 2,
        failed: 0,
        delayed: 0,
      }),
    };
    const dlq = {
      cleanup: jest.fn().mockResolvedValue(undefined),
      getMetrics: jest.fn().mockResolvedValue({ depth: 3, oldestAgeMs: 9_000 }),
    };
    const service = new AsyncMetricsService(
      inbound as never,
      {} as never,
      dlq as never,
    );
    service.recordProcessingDuration(10);
    service.recordProcessingDuration(100);
    service.recordRetry();
    service.recordStalled();
    service.recordClaimFailure();

    const snap = await service.snapshot();
    expect(snap.available).toBe(true);
    expect(snap.dlqWhatsappInbound).toBe(3);
    expect(snap.dlq?.oldestAgeMs).toBe(9_000);
    expect(snap.retriesTotal).toBe(1);
    expect(snap.stalledTotal).toBe(1);
    expect(snap.claimFailuresTotal).toBe(1);
    expect(snap.processingDurationP95Ms).toBeGreaterThanOrEqual(10);
  });
});
