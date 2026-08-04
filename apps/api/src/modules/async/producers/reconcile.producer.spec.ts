import { ReconcileProducer } from './reconcile.producer';
import { RECONCILE_CYCLE_JOB_NAME } from '../async.constants';

describe('ReconcileProducer', () => {
  it('enqueues cycle with bucketed jobId', async () => {
    const add = jest.fn().mockResolvedValue({ id: 'reconcile:cycle:1' });
    const producer = new ReconcileProducer(
      { add } as never,
      { get: jest.fn((_k: string, def?: unknown) => def) } as never,
    );

    const result = await producer.enqueueCycle('corr-1');
    expect(result.deduped).toBe(false);
    expect(add).toHaveBeenCalledWith(
      RECONCILE_CYCLE_JOB_NAME,
      expect.objectContaining({
        v: 1,
        correlationId: 'corr-1',
        trigger: 'schedule',
        take: 100,
      }),
      expect.objectContaining({
        jobId: expect.stringMatching(/^reconcile:cycle:\d+$/),
        attempts: 2,
      }),
    );
  });

  it('dedupes when jobId exists', async () => {
    const add = jest
      .fn()
      .mockRejectedValue(new Error('Job reconcile:cycle:1 already exists'));
    const producer = new ReconcileProducer(
      { add } as never,
      { get: jest.fn((_k: string, def?: unknown) => def) } as never,
    );

    const result = await producer.enqueueCycle('corr-1');
    expect(result.deduped).toBe(true);
  });
});
