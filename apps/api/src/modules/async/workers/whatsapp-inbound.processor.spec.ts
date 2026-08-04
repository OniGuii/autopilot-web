import { WhatsappInboundProcessor } from './whatsapp-inbound.processor';

describe('WhatsappInboundProcessor', () => {
  const metrics = {
    recordProcessingDuration: jest.fn(),
    recordRetry: jest.fn(),
    recordStalled: jest.fn(),
    recordClaimFailure: jest.fn(),
  };

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
      metrics as never,
      { recordQueueJobDuration: jest.fn() } as never,
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
    expect(result).toEqual({
      ok: true,
      correlationId: 'corr-1',
      skipped: false,
      reason: undefined,
    });
    expect(metrics.recordProcessingDuration).toHaveBeenCalled();
  });

  it('records claim failure when service skips', async () => {
    const whatsapp = {
      processQueuedWebhook: jest.fn().mockResolvedValue({
        ok: true,
        ignored: true,
        reason: 'CLAIM_FAILED',
      }),
    };
    const processor = new WhatsappInboundProcessor(
      whatsapp as never,
      { moveWhatsappInboundToDlq: jest.fn() } as never,
      metrics as never,
      { recordQueueJobDuration: jest.fn() } as never,
      { get: jest.fn((_k: string, def?: unknown) => def) } as never,
    );

    await processor.process({
      id: 'webhook:we-1',
      data: {
        v: 1,
        companyId: 'c1',
        webhookEventId: 'we-1',
        instanceId: 'i1',
        eventType: 'messages.upsert',
        correlationId: 'corr-1',
      },
    } as never);

    expect(metrics.recordClaimFailure).toHaveBeenCalled();
  });

  it('moves to DLQ only after final attempt and records retries', async () => {
    const whatsapp = { processQueuedWebhook: jest.fn() };
    const dlq = {
      moveWhatsappInboundToDlq: jest.fn().mockResolvedValue(undefined),
    };
    const config = {
      get: jest.fn((_k: string, def?: unknown) => def),
    };
    const processor = new WhatsappInboundProcessor(
      whatsapp as never,
      dlq as never,
      metrics as never,
      { recordQueueJobDuration: jest.fn() } as never,
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
    expect(metrics.recordRetry).toHaveBeenCalled();

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

  it('records stalled events', () => {
    const processor = new WhatsappInboundProcessor(
      {} as never,
      {} as never,
      metrics as never,
      { recordQueueJobDuration: jest.fn() } as never,
      { get: jest.fn((_k: string, def?: unknown) => def) } as never,
    );
    processor.onStalled('webhook:we-1');
    expect(metrics.recordStalled).toHaveBeenCalled();
  });
});
