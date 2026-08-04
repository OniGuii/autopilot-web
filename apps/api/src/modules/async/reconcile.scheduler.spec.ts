import { ReconcileScheduler } from './reconcile.scheduler';

describe('ReconcileScheduler', () => {
  it('no-ops when ASYNC_RECONCILE_ENABLED is false', async () => {
    const producer = { enqueueCycle: jest.fn() };
    const redis = { tryAcquireLock: jest.fn(), releaseLock: jest.fn() };
    const scheduler = new ReconcileScheduler(
      redis as never,
      producer as never,
      {
        get: jest.fn((key: string, def?: unknown) => {
          if (key === 'async.reconcileEnabled') return false;
          return def;
        }),
      } as never,
    );

    const result = await scheduler.tick();
    expect(result).toEqual({ enqueued: false });
    expect(producer.enqueueCycle).not.toHaveBeenCalled();
  });

  it('enqueues under lock when enabled', async () => {
    const producer = {
      enqueueCycle: jest
        .fn()
        .mockResolvedValue({ jobId: 'reconcile:cycle:1', deduped: false }),
    };
    const redis = {
      tryAcquireLock: jest.fn().mockResolvedValue('tok'),
      releaseLock: jest.fn(),
    };
    const scheduler = new ReconcileScheduler(
      redis as never,
      producer as never,
      {
        get: jest.fn((key: string, def?: unknown) => {
          if (key === 'async.reconcileEnabled') return true;
          return def;
        }),
      } as never,
    );

    const result = await scheduler.tick();
    expect(result).toEqual({ enqueued: true });
    expect(producer.enqueueCycle).toHaveBeenCalled();
    expect(redis.releaseLock).toHaveBeenCalled();
  });
});
