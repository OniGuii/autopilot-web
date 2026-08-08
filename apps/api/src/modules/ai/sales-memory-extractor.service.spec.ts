import { AiIntent } from '@prisma/client';
import { SalesMemoryExtractorService } from './sales-memory-extractor.service';

describe('SalesMemoryExtractorService (11E.1)', () => {
  const service = new SalesMemoryExtractorService();

  it('extracts budget / orçamento', () => {
    const patch = service.extract({
      message: 'Meu orçamento é até R$ 500',
    });
    expect(patch.budget).toMatch(/500/);
  });

  it('extracts city', () => {
    const patch = service.extract({
      message: 'Moro em Campinas e quero entrega',
    });
    expect(patch.city?.toLowerCase()).toContain('campinas');
  });

  it('extracts payment preference Pix', () => {
    const patch = service.extract({
      message: 'Prefiro pagar no pix',
      intent: AiIntent.PAYMENT,
    });
    expect(patch.paymentPreference).toBe('Pix');
  });

  it('extracts urgency HIGH', () => {
    const patch = service.extract({
      message: 'Preciso urgente para hoje',
    });
    expect(patch.urgency).toBe('HIGH');
  });

  it('extracts product interest', () => {
    const patch = service.extract({
      message: 'Tenho interesse no plano Pro anual',
      intent: AiIntent.PRODUCT,
    });
    expect(patch.productInterest?.some((p) => /plano/i.test(p))).toBe(true);
  });

  it('extracts objection CARO', () => {
    const patch = service.extract({
      message: 'Tá muito caro para mim',
    });
    expect(patch.lastObjection).toBe('CARO');
  });

  it('extracts purchase intent HIGH', () => {
    const patch = service.extract({
      message: 'Vamos fechar, manda o pix',
    });
    expect(patch.purchaseIntentLevel).toBe('HIGH');
  });

  it('returns empty patch for noise', () => {
    expect(service.extract({ message: 'oi' })).toEqual({});
  });
});
