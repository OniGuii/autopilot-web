import { AsyncMetricsService } from './async-metrics.service';

describe('AsyncMetricsService', () => {
  const emptyCounts = {
    waiting: 0,
    active: 0,
    completed: 0,
    failed: 0,
    delayed: 0,
  };

  function buildQueues(opts?: { fail?: boolean }) {
    const inbound = {
      getJobCounts: opts?.fail
        ? jest.fn().mockRejectedValue(new Error('redis down'))
        : jest.fn().mockResolvedValue({
            waiting: 1,
            active: 0,
            completed: 2,
            failed: 0,
            delayed: 0,
          }),
    };
    const followup = {
      getJobCounts: jest.fn().mockResolvedValue({ ...emptyCounts, waiting: 4 }),
    };
    const reconcile = {
      getJobCounts: jest.fn().mockResolvedValue({
        ...emptyCounts,
        waiting: 0,
        completed: 3,
      }),
    };
    const dlq = {
      cleanup: jest.fn().mockResolvedValue(undefined),
      getMetrics: jest.fn().mockResolvedValue({ depth: 3, oldestAgeMs: 9_000 }),
    };
    return { inbound, followup, reconcile, dlq };
  }

  it('returns available=false without inventing zero queue depths', async () => {
    const { inbound, followup, reconcile, dlq } = buildQueues({ fail: true });
    const service = new AsyncMetricsService(
      inbound as never,
      {} as never,
      followup as never,
      reconcile as never,
      dlq as never,
    );

    const snap = await service.snapshot();
    expect(snap.available).toBe(false);
    expect(snap.whatsappInbound).toBeNull();
    expect(snap.followupScheduler).toBeNull();
    expect(snap.reconcileWorker).toBeNull();
    expect(snap.dlqWhatsappInbound).toBeNull();
    expect(snap.reconcile.runs).toBe(0);
  });

  it('exposes reconcile counters and reconcileWorker counts', async () => {
    const { inbound, followup, reconcile, dlq } = buildQueues();
    const service = new AsyncMetricsService(
      inbound as never,
      {} as never,
      followup as never,
      reconcile as never,
      dlq as never,
    );
    service.recordReconcileRun({
      durationMs: 42,
      itemsChecked: 10,
      itemsFlagged: 3,
    });

    const snap = await service.snapshot();
    expect(snap.available).toBe(true);
    expect(snap.reconcileWorker).toEqual(
      expect.objectContaining({ completed: 3 }),
    );
    expect(snap.reconcile).toEqual({
      runs: 1,
      durationMs: 42,
      itemsChecked: 10,
      itemsFlagged: 3,
    });
  });
});
