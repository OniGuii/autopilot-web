import { ReconcileProcessor } from './reconcile.processor';

describe('ReconcileProcessor', () => {
  it('delegates to ReconcileCycleService', async () => {
    const cycle = {
      runCycle: jest.fn().mockResolvedValue({
        correlationId: 'corr-1',
        itemsChecked: 3,
        itemsFlagged: 1,
      }),
    };
    const metrics = {
      recordProcessingDuration: jest.fn(),
      recordRetry: jest.fn(),
      recordStalled: jest.fn(),
    };
    const processor = new ReconcileProcessor(
      cycle as never,
      metrics as never,
      { get: jest.fn((_k: string, def?: unknown) => def) } as never,
    );

    const result = await processor.process({
      id: 'reconcile:cycle:1',
      data: {
        v: 1,
        correlationId: 'corr-1',
        trigger: 'schedule',
        take: 100,
      },
    } as never);

    expect(result.ok).toBe(true);
    expect(cycle.runCycle).toHaveBeenCalled();
    expect(metrics.recordProcessingDuration).toHaveBeenCalled();
  });
});
