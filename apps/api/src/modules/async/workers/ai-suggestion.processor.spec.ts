import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { AiSuggestionProcessor } from './ai-suggestion.processor';

describe('AiSuggestionProcessor', () => {
  function buildMetrics() {
    return {
      recordProcessingDuration: jest.fn(),
      recordRetry: jest.fn(),
      recordStalled: jest.fn(),
      recordAiGenerated: jest.fn(),
      recordAiFailed: jest.fn(),
    };
  }

  const config = { get: jest.fn((_k: string, def?: unknown) => def) };

  const baseJob = {
    id: 'ai:suggest:c1:conv1',
    data: {
      v: 1 as const,
      companyId: 'c1',
      conversationId: 'conv1',
      actorUserId: 'u1',
      correlationId: 'corr-1',
      tone: 'professional' as const,
    },
  };

  it('delegates to processSuggestJob and records generated metric', async () => {
    const metrics = buildMetrics();
    const ai = {
      processSuggestJob: jest.fn().mockResolvedValue({
        ok: true,
        followUpId: 'fu-1',
        conversationId: 'conv1',
        leadId: 'lead-1',
        suggestion: 'oi',
        model: 'stub',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      }),
    };
    const processor = new AiSuggestionProcessor(
      ai as never,
      metrics as never,
      config as never,
    );

    const result = await processor.process(baseJob as never);

    expect(result).toEqual({
      ok: true,
      followUpId: 'fu-1',
      correlationId: 'corr-1',
    });
    expect(ai.processSuggestJob).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'c1',
        conversationId: 'conv1',
        actorUserId: 'u1',
      }),
    );
    expect(metrics.recordAiGenerated).toHaveBeenCalled();
    expect(metrics.recordProcessingDuration).toHaveBeenCalled();
  });

  it.each([
    ['404', new NotFoundException('missing')],
    ['400', new BadRequestException('invalid')],
    ['409', new ConflictException('lock')],
    ['429 quota', new HttpException('quota', HttpStatus.TOO_MANY_REQUESTS)],
  ])('maps %s to UnrecoverableError (no retry)', async (_label, err) => {
    const metrics = buildMetrics();
    const ai = {
      processSuggestJob: jest.fn().mockRejectedValue(err),
    };
    const processor = new AiSuggestionProcessor(
      ai as never,
      metrics as never,
      config as never,
    );

    await expect(processor.process(baseJob as never)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });

  it('allows retry for ServiceUnavailableException (OpenAI)', async () => {
    const metrics = buildMetrics();
    const ai = {
      processSuggestJob: jest
        .fn()
        .mockRejectedValue(
          new ServiceUnavailableException('OpenAI request failed'),
        ),
    };
    const processor = new AiSuggestionProcessor(
      ai as never,
      metrics as never,
      config as never,
    );

    await expect(processor.process(baseJob as never)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(metrics.recordAiGenerated).not.toHaveBeenCalled();
  });

  it('records ai failed on final failure event', () => {
    const metrics = buildMetrics();
    const processor = new AiSuggestionProcessor(
      {} as never,
      metrics as never,
      config as never,
    );
    processor.onFailed(
      {
        ...baseJob,
        attemptsMade: 3,
        opts: { attempts: 3 },
      } as never,
      new Error('boom'),
    );
    expect(metrics.recordAiFailed).toHaveBeenCalled();
  });
});
