/**
 * Hard navigation after auth cookie changes.
 * Soft router.replace can race with middleware (cookie not yet on the RSC request),
 * leaving the user on /login after a successful toast.
 */
export function navigateAfterAuth(path: string) {
  if (typeof window === "undefined") return;
  window.location.assign(path);
}
