import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC = ["/login", "/logout"];
const AUTH_ONLY = ["/select-company"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get("autopilot_has_session")?.value);
  const hasCompany = Boolean(request.cookies.get("autopilot_has_company")?.value);

  const isPublic = PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const isAuthOnly = AUTH_ONLY.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  const isApp =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/leads") ||
    pathname === "/";

  if (!hasSession && (isAuthOnly || isApp) && pathname !== "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (hasSession && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = hasCompany ? "/dashboard" : "/select-company";
    return NextResponse.redirect(url);
  }

  if (hasSession && !hasCompany && isApp) {
    const url = request.nextUrl.clone();
    url.pathname = "/select-company";
    return NextResponse.redirect(url);
  }

  if (hasSession && hasCompany && isAuthOnly) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  if (isPublic || isAuthOnly || isApp) {
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/login",
    "/logout",
    "/select-company",
    "/dashboard/:path*",
    "/leads/:path*",
  ],
};
