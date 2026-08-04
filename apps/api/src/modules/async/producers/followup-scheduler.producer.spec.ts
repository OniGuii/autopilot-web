import { FollowUpSchedulerProducer } from './followup-scheduler.producer';
import { FOLLOWUP_SCHEDULER_JOB_NAME } from '../async.constants';

describe('FollowUpSchedulerProducer', () => {
  it('enqueues with stable jobId', async () => {
    const add = jest.fn().mockResolvedValue({ id: 'followup:sched:fu-1' });
    const producer = new FollowUpSchedulerProducer(
      { add } as never,
      { get: jest.fn((_k: string, def?: unknown) => def) } as never,
    );

    const result = await producer.enqueue({
      v: 1,
      companyId: 'c1',
      followUpId: 'fu-1',
      correlationId: 'corr-1',
      trigger: 'schedule',
    });

    expect(result).toEqual({ jobId: 'followup:sched:fu-1', deduped: false });
    expect(add).toHaveBeenCalledWith(
      FOLLOWUP_SCHEDULER_JOB_NAME,
      expect.objectContaining({ followUpId: 'fu-1' }),
      expect.objectContaining({
        jobId: 'followup:sched:fu-1',
        attempts: 3,
      }),
    );
  });

  it('treats duplicate jobId as deduped success', async () => {
    const add = jest
      .fn()
      .mockRejectedValue(new Error('Job followup:sched:fu-1 already exists'));
    const producer = new FollowUpSchedulerProducer(
      { add } as never,
      { get: jest.fn((_k: string, def?: unknown) => def) } as never,
    );

    const result = await producer.enqueue({
      v: 1,
      companyId: 'c1',
      followUpId: 'fu-1',
      correlationId: 'corr-1',
      trigger: 'schedule',
    });

    expect(result).toEqual({ jobId: 'followup:sched:fu-1', deduped: true });
  });
});
