import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { FollowUpSchedulerProcessor } from './followup-scheduler.processor';

describe('FollowUpSchedulerProcessor', () => {
  const metrics = {
    recordProcessingDuration: jest.fn(),
    recordRetry: jest.fn(),
    recordStalled: jest.fn(),
    recordClaimFailure: jest.fn(),
  };

  const config = { get: jest.fn((_k: string, def?: unknown) => def) };

  it('delegates to executeDue and records claim failure skips', async () => {
    const followUps = {
      executeDue: jest.fn().mockResolvedValue({
        outcome: 'skipped_claim',
        correlationId: 'corr-1',
      }),
    };
    const processor = new FollowUpSchedulerProcessor(
      followUps as never,
      metrics as never,
      config as never,
    );

    const result = await processor.process({
      id: 'followup:sched:fu-1',
      data: {
        v: 1,
        companyId: 'c1',
        followUpId: 'fu-1',
        correlationId: 'corr-1',
        trigger: 'schedule',
      },
    } as never);

    expect(result.outcome).toBe('skipped_claim');
    expect(metrics.recordClaimFailure).toHaveBeenCalled();
    expect(metrics.recordProcessingDuration).toHaveBeenCalled();
  });

  it('maps disconnected ConflictException to UnrecoverableError', async () => {
    const followUps = {
      executeDue: jest
        .fn()
        .mockRejectedValue(
          new ConflictException('WhatsApp instance not CONNECTED'),
        ),
    };
    const processor = new FollowUpSchedulerProcessor(
      followUps as never,
      metrics as never,
      config as never,
    );

    await expect(
      processor.process({
        id: 'j1',
        data: {
          v: 1,
          companyId: 'c1',
          followUpId: 'fu-1',
          correlationId: 'corr-1',
          trigger: 'schedule',
        },
      } as never),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('allows retry for ServiceUnavailableException (circuit)', async () => {
    const followUps = {
      executeDue: jest
        .fn()
        .mockRejectedValue(new ServiceUnavailableException('CIRCUIT_OPEN')),
    };
    const processor = new FollowUpSchedulerProcessor(
      followUps as never,
      metrics as never,
      config as never,
    );

    await expect(
      processor.process({
        id: 'j1',
        data: {
          v: 1,
          companyId: 'c1',
          followUpId: 'fu-1',
          correlationId: 'corr-1',
          trigger: 'schedule',
        },
      } as never),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
