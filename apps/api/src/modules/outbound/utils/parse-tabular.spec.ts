import {
  guessColumnMapping,
  parseCsvBuffer,
  parsePasteTable,
} from './parse-tabular';

describe('parse-tabular (V1.2)', () => {
  it('parses CSV with headers and rows', () => {
    const csv = Buffer.from(
      'Nome,Telefone,Cidade\nAna,11987654321,SP\nBruno,21987654321,RJ\n',
      'utf8',
    );
    const parsed = parseCsvBuffer(csv);
    expect(parsed.kind).toBe('CSV');
    expect(parsed.headers).toEqual(['Nome', 'Telefone', 'Cidade']);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toEqual(['Ana', '11987654321', 'SP']);
  });

  it('parses semicolon CSV', () => {
    const csv = Buffer.from('Nome;Telefone\nAna;11987654321\n', 'utf8');
    const parsed = parseCsvBuffer(csv);
    expect(parsed.headers).toEqual(['Nome', 'Telefone']);
    expect(parsed.rows[0]).toEqual(['Ana', '11987654321']);
  });

  it('guesses Portuguese column mapping', () => {
    const mapping = guessColumnMapping([
      'Nome',
      'Telefone',
      'Cidade',
      'Produto',
      'Valor',
      'Origem',
      'Observação',
    ]);
    expect(mapping.phone).toBe('Telefone');
    expect(mapping.name).toBe('Nome');
    expect(mapping.city).toBe('Cidade');
    expect(mapping.product).toBe('Produto');
    expect(mapping.value).toBe('Valor');
    expect(mapping.source).toBe('Origem');
    expect(mapping.notes).toBe('Observação');
  });

  it('parses pasted TSV text', () => {
    const parsed = parsePasteTable({
      text: 'Nome\tTelefone\nAna\t11987654321\n',
    });
    expect(parsed.kind).toBe('PASTE');
    expect(parsed.headers).toEqual(['Nome', 'Telefone']);
    expect(parsed.rows).toEqual([['Ana', '11987654321']]);
  });
});
