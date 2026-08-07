import { AiIntent, KnowledgeBaseKind } from '@prisma/client';
import { KnowledgeBaseResolver } from './knowledge-base-resolver.service';

describe('KnowledgeBaseResolver (11B)', () => {
  const prisma = {
    knowledgeBaseEntry: {
      findMany: jest.fn(),
    },
  };

  let resolver: KnowledgeBaseResolver;

  beforeEach(() => {
    jest.clearAllMocks();
    resolver = new KnowledgeBaseResolver(prisma as never);
  });

  it('returns bestMatch for PRICE when entry overlaps message', async () => {
    prisma.knowledgeBaseEntry.findMany.mockResolvedValue([
      {
        id: 'kb-1',
        kind: KnowledgeBaseKind.PRICE,
        title: 'Preço Plano Pro',
        body: 'O plano pro custa R$ 199 por mês',
        tags: ['preco', 'plano'],
      },
    ]);

    const result = await resolver.resolve({
      companyId: 'c1',
      intent: AiIntent.PRICE,
      message: 'quanto custa o plano pro?',
    });

    expect(result.bestMatch?.id).toBe('kb-1');
    expect(result.confidence).toBeGreaterThan(0.2);
    expect(result.source).toContain('kb:PRICE:kb-1');
  });

  it('returns null when no overlap', async () => {
    prisma.knowledgeBaseEntry.findMany.mockResolvedValue([
      {
        id: 'kb-1',
        kind: KnowledgeBaseKind.PRICE,
        title: 'Tabela X',
        body: 'Item exclusivo sem relação',
        tags: [],
      },
    ]);

    const result = await resolver.resolve({
      companyId: 'c1',
      intent: AiIntent.PRICE,
      message: 'quanto custa o plano premium anual?',
    });

    expect(result.bestMatch).toBeNull();
  });

  it('skips HUMAN without querying useful kinds', async () => {
    const result = await resolver.resolve({
      companyId: 'c1',
      intent: AiIntent.HUMAN,
      message: 'quero falar com atendente',
    });
    expect(result.bestMatch).toBeNull();
    expect(prisma.knowledgeBaseEntry.findMany).not.toHaveBeenCalled();
  });
});
