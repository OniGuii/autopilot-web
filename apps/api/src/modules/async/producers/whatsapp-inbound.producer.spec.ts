import { WhatsappInboundProducer } from './whatsapp-inbound.producer';
import { WHATSAPP_INBOUND_JOB_NAME } from '../async.constants';

describe('WhatsappInboundProducer', () => {
  it('enqueues with stable jobId and correlationId (A11)', async () => {
    const add = jest.fn().mockResolvedValue({ id: 'webhook:we-1' });
    const queue = { add };
    const config = {
      get: jest.fn((_k: string, def?: unknown) => def),
    };
    const producer = new WhatsappInboundProducer(
      queue as never,
      config as never,
    );

    const result = await producer.enqueue({
      v: 1,
      companyId: 'c1',
      webhookEventId: 'we-1',
      instanceId: 'i1',
      eventType: 'messages.upsert',
      correlationId: 'corr-1',
    });

    expect(result.jobId).toBe('webhook:we-1');
    expect(add).toHaveBeenCalledWith(
      WHATSAPP_INBOUND_JOB_NAME,
      expect.objectContaining({
        correlationId: 'corr-1',
        webhookEventId: 'we-1',
      }),
      expect.objectContaining({
        jobId: 'webhook:we-1',
        attempts: 5,
        removeOnComplete: 1000,
        removeOnFail: 5000,
      }),
    );
  });

  it('treats jobId already exists as success', async () => {
    const add = jest
      .fn()
      .mockRejectedValue(new Error('Job webhook:we-1 already exists'));
    const producer = new WhatsappInboundProducer(
      { add } as never,
      { get: jest.fn((_k: string, def?: unknown) => def) } as never,
    );

    const result = await producer.enqueue({
      v: 1,
      companyId: 'c1',
      webhookEventId: 'we-1',
      instanceId: 'i1',
      eventType: 'messages.upsert',
      correlationId: 'corr-1',
    });

    expect(result.jobId).toBe('webhook:we-1');
  });
});
