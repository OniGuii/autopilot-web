import { AiSuggestionProducer } from './ai-suggestion.producer';

describe('AiSuggestionProducer', () => {
  const config = {
    get: jest.fn((_k: string, def?: unknown) => def),
  };

  it('enqueues with stable jobId per conversation', async () => {
    const add = jest.fn().mockResolvedValue({ id: 'ai:suggest:c1:conv1' });
    const producer = new AiSuggestionProducer(
      { add } as never,
      config as never,
    );

    const result = await producer.enqueue({
      v: 1,
      companyId: 'c1',
      conversationId: 'conv1',
      actorUserId: 'u1',
      correlationId: 'corr-1',
      tone: 'friendly',
    });

    expect(result).toEqual({
      jobId: 'ai:suggest:c1:conv1',
      deduped: false,
    });
    expect(add).toHaveBeenCalledWith(
      'generate-suggestion',
      expect.objectContaining({
        companyId: 'c1',
        conversationId: 'conv1',
        correlationId: 'corr-1',
      }),
      expect.objectContaining({
        jobId: 'ai:suggest:c1:conv1',
        attempts: 3,
        backoff: { type: 'exponential', delay: 3_000 },
      }),
    );
  });

  it('returns deduped when jobId already exists', async () => {
    const add = jest
      .fn()
      .mockRejectedValue(new Error('Job ai:suggest:c1:conv1 already exists'));
    const producer = new AiSuggestionProducer(
      { add } as never,
      config as never,
    );

    const result = await producer.enqueue({
      v: 1,
      companyId: 'c1',
      conversationId: 'conv1',
      actorUserId: 'u1',
      correlationId: 'corr-2',
    });

    expect(result).toEqual({
      jobId: 'ai:suggest:c1:conv1',
      deduped: true,
    });
  });
});
