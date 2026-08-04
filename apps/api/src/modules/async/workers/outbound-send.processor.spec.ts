import {
  BadGatewayException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { OutboundSendProcessor } from './outbound-send.processor';

describe('OutboundSendProcessor', () => {
  function buildMetrics() {
    return {
      recordProcessingDuration: jest.fn(),
      recordRetry: jest.fn(),
      recordStalled: jest.fn(),
      recordOutboundSent: jest.fn(),
      recordOutboundFailed: jest.fn(),
    };
  }

  const config = { get: jest.fn((_k: string, def?: unknown) => def) };

  const baseJob = {
    id: 'outbound:msg-1',
    data: {
      v: 1 as const,
      companyId: 'c1',
      messageId: 'msg-1',
      leadId: 'lead-1',
      conversationId: 'conv-1',
      actorUserId: 'u1',
      correlationId: 'corr-1',
    },
  };

  it('delegates to processOutboundJob and records sent metric', async () => {
    const metrics = buildMetrics();
    const whatsappSend = {
      processOutboundJob: jest.fn().mockResolvedValue({
        ok: true,
        messageId: 'msg-1',
        status: 'SENT',
        externalMessageId: 'EVO_1',
        correlationId: 'corr-1',
      }),
    };
    const processor = new OutboundSendProcessor(
      whatsappSend as never,
      metrics as never,
      { recordQueueJobDuration: jest.fn() } as never,
      config as never,
    );

    const result = await processor.process(baseJob as never);

    expect(result).toEqual({
      ok: true,
      messageId: 'msg-1',
      status: 'SENT',
      correlationId: 'corr-1',
    });
    expect(whatsappSend.processOutboundJob).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'c1',
        messageId: 'msg-1',
        actorUserId: 'u1',
      }),
    );
    expect(metrics.recordOutboundSent).toHaveBeenCalled();
    expect(metrics.recordProcessingDuration).toHaveBeenCalled();
  });

  it.each([
    ['404', new NotFoundException('missing')],
    ['409', new ConflictException('claimed')],
    ['502', new BadGatewayException('send failed')],
    ['503', new ServiceUnavailableException('circuit')],
  ])(
    'maps %s to UnrecoverableError (no Evolution retry)',
    async (_label, err) => {
      const metrics = buildMetrics();
      const whatsappSend = {
        processOutboundJob: jest.fn().mockRejectedValue(err),
      };
      const processor = new OutboundSendProcessor(
        whatsappSend as never,
        metrics as never,
        { recordQueueJobDuration: jest.fn() } as never,
        config as never,
      );

      await expect(processor.process(baseJob as never)).rejects.toBeInstanceOf(
        UnrecoverableError,
      );
    },
  );

  it('records outbound failed on final failure event', () => {
    const metrics = buildMetrics();
    const processor = new OutboundSendProcessor(
      {} as never,
      metrics as never,
      { recordQueueJobDuration: jest.fn() } as never,
      config as never,
    );

    processor.onFailed(
      {
        ...baseJob,
        attemptsMade: 1,
        opts: { attempts: 1 },
      } as never,
      new Error('boom'),
    );

    expect(metrics.recordOutboundFailed).toHaveBeenCalled();
  });
});
