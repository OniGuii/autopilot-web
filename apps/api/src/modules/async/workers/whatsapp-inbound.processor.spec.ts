import { WhatsappInboundProcessor } from './whatsapp-inbound.processor';

describe('WhatsappInboundProcessor', () => {
  it('delegates to WhatsappService.processQueuedWebhook', async () => {
    const whatsapp = {
      processQueuedWebhook: jest.fn().mockResolvedValue({ ok: true }),
    };
    const dlq = { moveWhatsappInboundToDlq: jest.fn() };
    const config = {
      get: jest.fn((_k: string, def?: unknown) => def),
    };
    const processor = new WhatsappInboundProcessor(
      whatsapp as never,
      dlq as never,
      config as never,
    );

    const payload = {
      v: 1 as const,
      companyId: 'c1',
      webhookEventId: 'we-1',
      instanceId: 'i1',
      eventType: 'messages.upsert',
      correlationId: 'corr-1',
    };

    const result = await processor.process({
      id: 'webhook:we-1',
      data: payload,
    } as never);

    expect(whatsapp.processQueuedWebhook).toHaveBeenCalledWith(payload);
    expect(result).toEqual({ ok: true, correlationId: 'corr-1' });
  });

  it('moves to DLQ only after final attempt', async () => {
    const whatsapp = { processQueuedWebhook: jest.fn() };
    const dlq = { moveWhatsappInboundToDlq: jest.fn().mockResolvedValue(undefined) };
    const config = {
      get: jest.fn((_k: string, def?: unknown) => def),
    };
    const processor = new WhatsappInboundProcessor(
      whatsapp as never,
      dlq as never,
      config as never,
    );

    const payload = {
      v: 1 as const,
      companyId: 'c1',
      webhookEventId: 'we-1',
      instanceId: 'i1',
      eventType: 'messages.upsert',
      correlationId: 'corr-1',
    };

    await processor.onFailed(
      {
        id: 'webhook:we-1',
        data: payload,
        attemptsMade: 2,
        opts: { attempts: 5 },
      } as never,
      new Error('tmp'),
    );
    expect(dlq.moveWhatsappInboundToDlq).not.toHaveBeenCalled();

    await processor.onFailed(
      {
        id: 'webhook:we-1',
        data: payload,
        attemptsMade: 5,
        opts: { attempts: 5 },
      } as never,
      new Error('final'),
    );
    expect(dlq.moveWhatsappInboundToDlq).toHaveBeenCalledWith(
      expect.objectContaining({
        originalJobId: 'webhook:we-1',
        attemptsMade: 5,
        payload,
      }),
    );
  });
});
