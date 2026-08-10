import { normalizeImportPhone } from './normalize-import-phone';

describe('normalizeImportPhone (V1.2)', () => {
  it('accepts BR mobile with country code', () => {
    expect(normalizeImportPhone('+55 (11) 98765-4321')).toEqual({
      ok: true,
      phone: '5511987654321',
    });
  });

  it('prepends 55 for local 11-digit mobile', () => {
    expect(normalizeImportPhone('11987654321')).toEqual({
      ok: true,
      phone: '5511987654321',
    });
  });

  it('rejects empty', () => {
    expect(normalizeImportPhone('')).toEqual({
      ok: false,
      reason: 'PHONE_REQUIRED',
    });
  });

  it('rejects too short', () => {
    expect(normalizeImportPhone('12345')).toEqual({
      ok: false,
      reason: 'PHONE_INVALID_LENGTH',
    });
  });
});
