/**
 * Full navigation after auth state changes.
 * Prefer this over soft router.replace when session tokens/cookies just changed,
 * so the next document load bootstraps AuthProvider from localStorage cleanly.
 */
export function navigateAfterAuth(path: string) {
  if (typeof window === "undefined") return;
  // Defer one tick so document.cookie writes from setSessionTokens are visible
  // before the browser issues the next document request.
  window.setTimeout(() => {
    window.location.assign(path);
  }, 0);
}
