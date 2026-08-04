const ACCESS_KEY = "autopilot.accessToken";
const REFRESH_KEY = "autopilot.refreshToken";
const HAS_COMPANY_COOKIE = "autopilot_has_company";
const HAS_SESSION_COOKIE = "autopilot_has_session";

function canUseDom() {
  return typeof window !== "undefined";
}

function setCookie(name: string, value: string, maxAgeSeconds = 60 * 60 * 24 * 7) {
  if (!canUseDom()) return;
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax`;
}

function clearCookie(name: string) {
  if (!canUseDom()) return;
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
}

export type SessionTokens = {
  accessToken: string;
  refreshToken: string;
  hasCompany: boolean;
};

export function getAccessToken(): string | null {
  if (!canUseDom()) return null;
  return localStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  if (!canUseDom()) return null;
  return localStorage.getItem(REFRESH_KEY);
}

export function setSessionTokens(tokens: SessionTokens) {
  if (!canUseDom()) return;
  localStorage.setItem(ACCESS_KEY, tokens.accessToken);
  localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
  setCookie(HAS_SESSION_COOKIE, "1");
  if (tokens.hasCompany) {
    setCookie(HAS_COMPANY_COOKIE, "1");
  } else {
    clearCookie(HAS_COMPANY_COOKIE);
  }
}

export function clearSession() {
  if (!canUseDom()) return;
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  clearCookie(HAS_SESSION_COOKIE);
  clearCookie(HAS_COMPANY_COOKIE);
}

export function hasCompanyContextCookie() {
  if (!canUseDom()) return false;
  return document.cookie.split("; ").some((c) => c.startsWith(`${HAS_COMPANY_COOKIE}=`));
}
