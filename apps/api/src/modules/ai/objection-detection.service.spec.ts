import { ObjectionDetectionService } from './objection-detection.service';

describe('ObjectionDetectionService (11E.3)', () => {
  const service = new ObjectionDetectionService();

  it.each([
    ['Tá caro demais', 'PRICE'],
    ['Estou sem dinheiro agora', 'PRICE'],
    ['Vou pensar e te falo', 'TIME'],
    ['Me chama mais tarde', 'TIME'],
    ['Não conheço essa empresa', 'TRUST'],
    ['É confiável?', 'TRUST'],
    ['Estou comparando com outra loja', 'COMPARISON'],
    ['Vou falar com meu sócio', 'AUTHORITY'],
    ['Preciso de aprovação do gerente', 'AUTHORITY'],
    ['Não preciso disso', 'NEED'],
    ['Não vejo vantagem', 'NEED'],
  ] as const)('detects %s → %s', (message, type) => {
    const result = service.detect(message);
    expect(result.detected).toBe(true);
    expect(result.type).toBe(type);
    expect(result.matchedPhrase).toBeTruthy();
  });

  it('returns not detected for neutral message', () => {
    expect(service.detect('Qual o horário de atendimento?')).toEqual({
      detected: false,
      type: null,
      matchedPhrase: null,
    });
  });
});
