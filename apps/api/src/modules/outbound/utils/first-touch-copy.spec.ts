import { buildFirstTouchBody } from './first-touch-copy';

describe('buildFirstTouchBody', () => {
  it('builds financeira copy with name and product', () => {
    const body = buildFirstTouchBody({
      companyName: 'CrediX',
      leadName: 'Ana Silva',
      product: 'consórcio',
      city: null,
      value: '50000',
      notes: null,
      kbSnippet: null,
      playbook: 'financeira',
    });
    expect(body).toContain('Ana');
    expect(body).toContain('CrediX');
    expect(body).toContain('consórcio');
    expect(body.length).toBeLessThanOrEqual(500);
  });

  it('falls back when name missing', () => {
    const body = buildFirstTouchBody({
      companyName: 'Loja',
      leadName: null,
      product: 'Kit solar',
      city: 'Campinas',
      value: null,
      notes: null,
      kbSnippet: null,
      playbook: 'solar',
    });
    expect(body.startsWith('Oi!')).toBe(true);
    expect(body).toContain('Campinas');
  });
});
