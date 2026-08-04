import { FollowUpStatus } from '@prisma/client';
import { FollowUpDueScanner } from './followup-due.scanner';

describe('FollowUpDueScanner', () => {
  it('no-ops when ASYNC_FOLLOWUP_ENABLED is false', async () => {
    const prisma = { followUp: { findMany: jest.fn() } };
    const redis = {
      tryAcquireLock: jest.fn(),
      releaseLock: jest.fn(),
    };
    const producer = { enqueue: jest.fn() };
    const scanner = new FollowUpDueScanner(
      prisma as never,
      redis as never,
      producer as never,
      {
        get: jest.fn((key: string, def?: unknown) => {
          if (key === 'async.followupEnabled') return false;
          return def;
        }),
      } as never,
    );

    const result = await scanner.tick();
    expect(result).toEqual({ enqueued: 0, scanned: 0 });
    expect(prisma.followUp.findMany).not.toHaveBeenCalled();
  });

  it('enqueues due SCHEDULED follow-ups under lock', async () => {
    const prisma = {
      followUp: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'fu-1', companyId: 'c1' },
          { id: 'fu-2', companyId: 'c1' },
        ]),
      },
    };
    const redis = {
      tryAcquireLock: jest.fn().mockResolvedValue('tok'),
      releaseLock: jest.fn().mockResolvedValue(undefined),
    };
    const producer = {
      enqueue: jest
        .fn()
        .mockResolvedValueOnce({ jobId: 'followup:sched:fu-1', deduped: false })
        .mockResolvedValueOnce({ jobId: 'followup:sched:fu-2', deduped: true }),
    };
    const scanner = new FollowUpDueScanner(
      prisma as never,
      redis as never,
      producer as never,
      {
        get: jest.fn((key: string, def?: unknown) => {
          if (key === 'async.followupEnabled') return true;
          return def;
        }),
      } as never,
    );

    const result = await scanner.tick();
    expect(result).toEqual({ enqueued: 1, scanned: 2 });
    expect(prisma.followUp.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: FollowUpStatus.SCHEDULED,
        }),
      }),
    );
    expect(producer.enqueue).toHaveBeenCalledTimes(2);
    expect(redis.releaseLock).toHaveBeenCalled();
  });
});
