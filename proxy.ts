import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Optimistic gate only: redirects signed-out visitors before any page work happens.
 * Real authorization is always re-checked server-side (requirePageAuth / api()).
 */
export function proxy(req: NextRequest) {
  if (!req.cookies.has("ols_session")) {
    const url = new URL("/login", req.url);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*", "/find-leads/:path*", "/leads/:path*", "/lists/:path*", "/saved-searches/:path*", "/map/:path*",
    "/sources/:path*", "/verification/:path*", "/analytics/:path*", "/outreach/:path*", "/team/:path*", "/integrations/:path*",
    "/settings/:path*", "/searches/:path*",
  ],
};
