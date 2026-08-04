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
    const aiSuggestions = {
      getJobCounts: jest.fn().mockResolvedValue({
        ...emptyCounts,
        waiting: 2,
        completed: 5,
      }),
    };
    const outbound = {
      getJobCounts: jest.fn().mockResolvedValue({
        ...emptyCounts,
        waiting: 7,
        completed: 9,
      }),
    };
    const dlq = {
      cleanup: jest.fn().mockResolvedValue(undefined),
      getMetrics: jest.fn().mockResolvedValue({ depth: 3, oldestAgeMs: 9_000 }),
    };
    return { inbound, followup, reconcile, aiSuggestions, outbound, dlq };
  }

  it('returns available=false without inventing zero queue depths', async () => {
    const { inbound, followup, reconcile, aiSuggestions, outbound, dlq } =
      buildQueues({
        fail: true,
      });
    const service = new AsyncMetricsService(
      inbound as never,
      {} as never,
      followup as never,
      reconcile as never,
      aiSuggestions as never,
      outbound as never,
      dlq as never,
    );

    const snap = await service.snapshot();
    expect(snap.available).toBe(false);
    expect(snap.whatsappInbound).toBeNull();
    expect(snap.followupScheduler).toBeNull();
    expect(snap.reconcileWorker).toBeNull();
    expect(snap.aiSuggestions).toBeNull();
    expect(snap.outbound).toBeNull();
    expect(snap.dlqWhatsappInbound).toBeNull();
    expect(snap.reconcile.runs).toBe(0);
    expect(snap.ai).toEqual({ generated: 0, failed: 0, avgDuration: null });
  });

  it('exposes reconcile + aiSuggestions + outbound counters', async () => {
    const { inbound, followup, reconcile, aiSuggestions, outbound, dlq } =
      buildQueues();
    const service = new AsyncMetricsService(
      inbound as never,
      {} as never,
      followup as never,
      reconcile as never,
      aiSuggestions as never,
      outbound as never,
      dlq as never,
    );
    service.recordReconcileRun({
      durationMs: 42,
      itemsChecked: 10,
      itemsFlagged: 3,
    });
    service.recordAiGenerated(100);
    service.recordAiGenerated(200);
    service.recordAiFailed();
    service.recordOutboundSent(50);
    service.recordOutboundSent(150);
    service.recordOutboundFailed();

    const snap = await service.snapshot();
    expect(snap.available).toBe(true);
    expect(snap.reconcileWorker).toEqual(
      expect.objectContaining({ completed: 3 }),
    );
    expect(snap.aiSuggestions).toEqual(
      expect.objectContaining({ waiting: 2, completed: 5 }),
    );
    expect(snap.outbound).toEqual(
      expect.objectContaining({
        waiting: 7,
        completed: 9,
        sent: 2,
        failures: 1,
        avgDuration: 100,
      }),
    );
    expect(snap.reconcile).toEqual({
      runs: 1,
      durationMs: 42,
      itemsChecked: 10,
      itemsFlagged: 3,
    });
    expect(snap.ai).toEqual({
      generated: 2,
      failed: 1,
      avgDuration: 150,
    });
  });
});
