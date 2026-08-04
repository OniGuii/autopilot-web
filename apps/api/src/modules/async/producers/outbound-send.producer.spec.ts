import { OutboundSendProducer } from './outbound-send.producer';

describe('OutboundSendProducer', () => {
  const config = {
    get: jest.fn((_k: string, def?: unknown) => def),
  };

  it('enqueues with stable jobId per messageId', async () => {
    const add = jest.fn().mockResolvedValue({ id: 'outbound:msg-1' });
    const producer = new OutboundSendProducer(
      { add } as never,
      config as never,
    );

    const result = await producer.enqueue({
      v: 1,
      companyId: 'c1',
      messageId: 'msg-1',
      leadId: 'lead-1',
      conversationId: 'conv-1',
      actorUserId: 'u1',
      correlationId: 'corr-1',
    });

    expect(result).toEqual({
      jobId: 'outbound:msg-1',
      deduped: false,
    });
    expect(add).toHaveBeenCalledWith(
      'send-outbound',
      expect.objectContaining({
        companyId: 'c1',
        messageId: 'msg-1',
        correlationId: 'corr-1',
      }),
      expect.objectContaining({
        jobId: 'outbound:msg-1',
        attempts: 1,
        backoff: { type: 'exponential', delay: 3_000 },
      }),
    );
  });

  it('returns deduped when jobId already exists', async () => {
    const add = jest
      .fn()
      .mockRejectedValue(new Error('Job outbound:msg-1 already exists'));
    const producer = new OutboundSendProducer(
      { add } as never,
      config as never,
    );

    const result = await producer.enqueue({
      v: 1,
      companyId: 'c1',
      messageId: 'msg-1',
      leadId: 'lead-1',
      conversationId: 'conv-1',
      actorUserId: 'u1',
      correlationId: 'corr-2',
    });

    expect(result).toEqual({
      jobId: 'outbound:msg-1',
      deduped: true,
    });
  });
});
