import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConversationStatus, FollowUpStatus } from '@prisma/client';
import {
  AI_FOLLOWUP_TYPE,
  AI_RATE_LIMIT_PER_DAY,
  AI_RATE_LIMIT_PER_MINUTE,
  AI_SUGGESTION_GENERATED,
} from './ai.constants';
import { AiService } from './ai.service';

describe('AiService', () => {
  const companyId = '11111111-1111-1111-1111-111111111111';
  const otherCompany = '99999999-9999-9999-9999-999999999999';
  const conversationId = '22222222-2222-2222-2222-222222222222';
  const actor = {
    sub: 'user-1',
    cid: companyId,
    mid: 'mem-1',
    role: 'AGENT',
  } as never;

  const conversation = {
    id: conversationId,
    companyId,
    leadId: 'lead-1',
    status: ConversationStatus.OPEN,
    deletedAt: null,
    lead: {
      id: 'lead-1',
      name: 'Maria',
      phone: '+5511999999999',
      status: 'NEW',
      source: 'WHATSAPP',
      deletedAt: null,
    },
  };

  function build(opts?: {
    conversation?: Record<string, unknown> | null;
    messages?: Array<{ direction: string; body: string | null }>;
    minuteCount?: number;
    dayCount?: number;
    openaiImpl?: jest.Mock;
  }) {
    const audits: unknown[] = [];
    let countCalls = 0;

    const prisma = {
      conversation: {
        findFirst: jest.fn().mockResolvedValue(
          opts?.conversation === undefined
            ? { ...conversation }
            : opts.conversation,
        ),
      },
      message: {
        findMany: jest.fn().mockResolvedValue(
          opts?.messages ?? [
            { direction: 'INBOUND', body: 'Olá, ainda tem o carro?' },
          ],
        ),
      },
      followUp: {
        count: jest.fn().mockImplementation(async ({ where }) => {
          countCalls += 1;
          const since = where?.createdAt?.gte as Date | undefined;
          if (!since) return 0;
          const windowMs = Date.now() - since.getTime();
          // janela de 1 minuto ≈ 60s; diária ≫ 60s
          if (windowMs <= 90_000) {
            return opts?.minuteCount ?? 0;
          }
          return opts?.dayCount ?? 0;
        }),
        create: jest.fn().mockImplementation(async ({ data }) => ({
          id: 'fu-ai-1',
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        })),
      },
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) =>
        fn({
          followUp: prisma.followUp,
          auditLog: {},
        }),
      ),
    };

    const audit = {
      write: jest.fn(async (_tx: unknown, input: unknown) => {
        audits.push(input);
        return { id: 'a' };
      }),
    };

    const openai = {
      chatCompletion:
        opts?.openaiImpl ??
        jest.fn().mockResolvedValue({
          stub: true,
          model: 'gpt-4o-mini-stub',
          content: 'Olá! Sim, posso te ajudar com isso.',
          usage: {
            promptTokens: 10,
            completionTokens: 8,
            totalTokens: 18,
          },
        }),
    };

    const service = new AiService(
      prisma as never,
      audit as never,
      openai as never,
    );

    return { service, prisma, audit, openai, audits, countCalls: () => countCalls };
  }

  it('gera FollowUp AI_REPLY SUGGESTED e audita AI_SUGGESTION_GENERATED', async () => {
    const { service, prisma, openai, audits } = build();

    const result = await service.suggestForConversation(
      actor,
      conversationId,
      {},
    );

    expect(result.ok).toBe(true);
    expect(result.followUpId).toBe('fu-ai-1');
    expect(result.suggestion).toContain('Olá');
    expect(prisma.followUp.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId,
          conversationId,
          type: AI_FOLLOWUP_TYPE,
          status: FollowUpStatus.SUGGESTED,
          assignedUserId: 'user-1',
          metadata: expect.objectContaining({ source: 'ai' }),
        }),
      }),
    );
    expect(openai.chatCompletion).toHaveBeenCalled();
    expect(audits.map((a) => (a as { action: string }).action)).toEqual([
      AI_SUGGESTION_GENERATED,
    ]);
  });

  it('retorna 404 para conversation de outro tenant', async () => {
    const { service, prisma } = build({ conversation: null });
    prisma.conversation.findFirst.mockImplementation(async ({ where }) => {
      if (where.companyId !== companyId) return null;
      return null;
    });

    await expect(
      service.suggestForConversation(
        { ...actor, cid: otherCompany } as never,
        conversationId,
        {},
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejeita Conversation CLOSED com BadRequest', async () => {
    const { service } = build({
      conversation: {
        ...conversation,
        status: ConversationStatus.CLOSED,
      },
    });

    await expect(
      service.suggestForConversation(actor, conversationId, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('aplica lock lógico: segunda geração simultânea na mesma conversation falha', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const openaiImpl = jest.fn(async () => {
      await gate;
      return {
        stub: true,
        model: 'stub',
        content: 'ok',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      };
    });
    const { service } = build({ openaiImpl });

    const first = service.suggestForConversation(actor, conversationId, {});

    // Aguarda a 1ª geração chegar no OpenAI (lock já adquirido).
    for (let i = 0; i < 50 && openaiImpl.mock.calls.length === 0; i += 1) {
      await Promise.resolve();
    }
    expect(openaiImpl).toHaveBeenCalled();

    await expect(
      service.suggestForConversation(actor, conversationId, {}),
    ).rejects.toBeInstanceOf(ConflictException);

    release();
    await first;
  });

  it('rate limit por minuto retorna 429', async () => {
    const { service } = build({ minuteCount: AI_RATE_LIMIT_PER_MINUTE });

    await expect(
      service.suggestForConversation(actor, conversationId, {}),
    ).rejects.toMatchObject({
      status: 429,
    } as HttpException);
  });

  it('rate limit diário retorna 429', async () => {
    const { service } = build({
      minuteCount: 0,
      dayCount: AI_RATE_LIMIT_PER_DAY,
    });

    await expect(
      service.suggestForConversation(actor, conversationId, {}),
    ).rejects.toMatchObject({
      status: 429,
    } as HttpException);
  });

  it('propaga 503 quando OpenAI não está configurada', async () => {
    const { service } = build({
      openaiImpl: jest
        .fn()
        .mockRejectedValue(
          new ServiceUnavailableException('OpenAI API key is not configured'),
        ),
    });

    await expect(
      service.suggestForConversation(actor, conversationId, {}),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('rejeita contexto sem mensagens com body', async () => {
    const { service } = build({
      messages: [
        { direction: 'INBOUND', body: null },
        { direction: 'OUTBOUND', body: '   ' },
      ],
    });

    await expect(
      service.suggestForConversation(actor, conversationId, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
