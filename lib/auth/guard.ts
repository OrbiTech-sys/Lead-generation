import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AuthError, hasRole, resolveSession, type AuthContext } from "./service";

export const SESSION_COOKIE = "ols_session";

export async function getAuth(): Promise<AuthContext | null> {
  const jar = await cookies();
  return resolveSession(jar.get(SESSION_COOKIE)?.value);
}

/** For Server Components / pages: redirect to /login when signed out. */
export async function requirePageAuth(): Promise<AuthContext> {
  const ctx = await getAuth();
  if (!ctx) redirect("/login");
  return ctx;
}

/** Wrap a Route Handler: auth, optional minimum role, and uniform JSON errors. */
export function api<A extends unknown[]>(
  handler: (req: Request, ctx: AuthContext, ...rest: A) => Promise<Response | unknown>,
  opts: { role?: "viewer" | "member" | "admin" | "owner" } = {},
) {
  return async (req: Request, ...rest: A): Promise<Response> => {
    try {
      const ctx = await getAuth();
      if (!ctx) throw new AuthError("Not signed in.", 401);
      // CSRF defence in depth on top of SameSite=Lax: state-changing calls must be same-origin JSON/fetch.
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
        const origin = req.headers.get("origin");
        const host = req.headers.get("host");
        if (origin && host && new URL(origin).host !== host) throw new AuthError("Cross-origin request rejected.", 403);
      }
      const min = opts.role ?? (req.method === "GET" ? "viewer" : "member");
      if (!hasRole(ctx, min)) throw new AuthError("Your role does not allow this action.", 403);
      const out = await handler(req, ctx, ...rest);
      return out instanceof Response ? out : Response.json(out);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function errorResponse(e: unknown): Response {
  // Next.js uses thrown errors with a `digest` for control flow (prerender interruption, redirects, not-found).
  // They are not failures: rethrow so the framework handles them instead of logging/answering 500.
  if (typeof (e as { digest?: unknown } | null)?.digest === "string") throw e;
  if (e instanceof AuthError) return Response.json({ error: e.message }, { status: e.status });
  if (e instanceof z.ZodError) {
    return Response.json({ error: "Invalid input.", issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, { status: 400 });
  }
  console.error("[api]", e);
  return Response.json({ error: e instanceof Error ? e.message : "Unexpected error." }, { status: 500 });
}
