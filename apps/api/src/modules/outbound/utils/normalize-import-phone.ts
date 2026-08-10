import { normalizePhone } from '../../leads/utils/normalize-phone';

export type ImportPhoneResult =
  { ok: true; phone: string } | { ok: false; reason: string };

/**
 * BR E.164-ish validation on top of digits-only storage.
 * Accepts 10–11 local digits (prepends 55) or 12–13 with country 55.
 */
export function normalizeImportPhone(raw: string): ImportPhoneResult {
  const digits = normalizePhone(raw ?? '');
  if (!digits) {
    return { ok: false, reason: 'PHONE_REQUIRED' };
  }
  if (digits.length < 10 || digits.length > 13) {
    return { ok: false, reason: 'PHONE_INVALID_LENGTH' };
  }

  let phone = digits;
  if (!phone.startsWith('55') && (phone.length === 10 || phone.length === 11)) {
    phone = `55${phone}`;
  }

  if (!phone.startsWith('55') || phone.length < 12 || phone.length > 13) {
    return { ok: false, reason: 'PHONE_INVALID_BR' };
  }

  // DDD 11–99, mobile often 9 digits after DDD
  const national = phone.slice(2);
  if (national.length < 10 || national.length > 11) {
    return { ok: false, reason: 'PHONE_INVALID_BR' };
  }

  return { ok: true, phone };
}
