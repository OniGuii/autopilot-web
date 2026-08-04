import { AsyncMetricsService } from './async-metrics.service';

describe('AsyncMetricsService', () => {
  const emptyCounts = {
    waiting: 0,
    active: 0,
    completed: 0,
    failed: 0,
    delayed: 0,
  };

  it('returns available=false without inventing zero queue depths', async () => {
    const inbound = {
      getJobCounts: jest.fn().mockRejectedValue(new Error('redis down')),
    };
    const followup = { getJobCounts: jest.fn() };
    const dlq = {
      cleanup: jest.fn().mockResolvedValue(undefined),
      getMetrics: jest.fn(),
    };
    const service = new AsyncMetricsService(
      inbound as never,
      {} as never,
      followup as never,
      dlq as never,
    );

    const snap = await service.snapshot();
    expect(snap.available).toBe(false);
    expect(snap.whatsappInbound).toBeNull();
    expect(snap.followupScheduler).toBeNull();
    expect(snap.dlqWhatsappInbound).toBeNull();
    expect(snap.error).toContain('redis down');
  });

  it('exposes followupScheduler counts and processing counters', async () => {
    const inbound = {
      getJobCounts: jest.fn().mockResolvedValue({
        waiting: 1,
        active: 0,
        completed: 2,
        failed: 0,
        delayed: 0,
      }),
    };
    const followup = {
      getJobCounts: jest.fn().mockResolvedValue({
        waiting: 4,
        active: 1,
        completed: 9,
        failed: 2,
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
      followup as never,
      dlq as never,
    );
    service.recordProcessingDuration(10);
    service.recordRetry();

    const snap = await service.snapshot();
    expect(snap.available).toBe(true);
    expect(snap.followupScheduler).toEqual({
      waiting: 4,
      active: 1,
      completed: 9,
      failed: 2,
      delayed: 0,
    });
    expect(snap.whatsappInbound).toEqual({
      ...emptyCounts,
      waiting: 1,
      completed: 2,
    });
    expect(snap.retriesTotal).toBe(1);
  });
});
