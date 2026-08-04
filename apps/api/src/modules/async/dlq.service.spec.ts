import { DlqService } from './dlq.service';

describe('DlqService', () => {
  it('adds dead-letter then cleans up', async () => {
    const add = jest.fn().mockResolvedValue({ id: 'dlq:webhook:we-1' });
    const clean = jest.fn().mockResolvedValue([]);
    const getJobs = jest.fn().mockResolvedValue([]);
    const dlqQueue = { add, clean, getJobs };
    const config = {
      get: jest.fn((key: string, def?: unknown) => {
        if (key === 'async.dlqMaxJobs') return 2;
        if (key === 'async.dlqRetentionMs') return 60_000;
        return def;
      }),
    };
    const service = new DlqService(dlqQueue as never, config as never);

    await service.moveWhatsappInboundToDlq({
      originalJobId: 'webhook:we-1',
      failedReason: 'boom',
      attemptsMade: 5,
      payload: {
        v: 1,
        companyId: 'c1',
        webhookEventId: 'we-1',
        instanceId: 'i1',
        eventType: 'messages.upsert',
        correlationId: 'corr-1',
      },
    });

    expect(add).toHaveBeenCalledWith(
      'dead-letter',
      expect.objectContaining({
        originalJobId: 'webhook:we-1',
        correlationId: 'corr-1',
      }),
      expect.objectContaining({ jobId: 'dlq:webhook:we-1' }),
    );
    expect(clean).toHaveBeenCalled();
  });

  it('trims overflow beyond max jobs', async () => {
    const remove = jest.fn().mockResolvedValue(undefined);
    const jobs = [
      { id: 'a', timestamp: 1, remove },
      { id: 'b', timestamp: 2, remove },
      { id: 'c', timestamp: 3, remove },
    ];
    const dlqQueue = {
      add: jest.fn(),
      clean: jest.fn().mockResolvedValue([]),
      getJobs: jest.fn().mockResolvedValue(jobs),
    };
    const service = new DlqService(
      dlqQueue as never,
      {
        get: jest.fn((key: string, def?: unknown) => {
          if (key === 'async.dlqMaxJobs') return 2;
          if (key === 'async.dlqRetentionMs') return 60_000_000;
          return def;
        }),
      } as never,
    );

    await service.cleanup();
    expect(remove).toHaveBeenCalled();
  });
});
