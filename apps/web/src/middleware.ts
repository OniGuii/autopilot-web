import { NextResponse } from "next/server";

/**
 * Auth redirects live in client `RequireAuth` + AuthProvider.
 *
 * Cookie gates here raced with localStorage tokens: after login/select-company
 * the toast succeeded but hard/soft navigation bounced back to /login because
 * the middleware often did not see `autopilot_has_*` cookies on the next request.
 */
export function middleware() {
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/login",
    "/logout",
    "/select-company",
    "/setup",
    "/dashboard/:path*",
    "/leads/:path*",
    "/conversations/:path*",
    "/follow-ups/:path*",
    "/whatsapp/:path*",
    "/pipeline",
    "/team",
    "/users",
    "/settings",
    "/ai/:path*",
    "/exports",
    "/diagnostics",
  ],
};
