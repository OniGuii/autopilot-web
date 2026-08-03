/** Keep digits only (frozen decision — Leads MVP). */
export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}
