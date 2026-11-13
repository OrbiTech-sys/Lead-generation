import { cookies } from "next/headers";
import { z } from "zod";
import { SESSION_COOKIE, errorResponse, getAuth } from "@/lib/auth/guard";
import { rateLimit } from "@/lib/auth/rate-limit";
import { AuthError, SESSION_DAYS, authenticate, createSession, destroySession, registerUser } from "@/lib/auth/service";

const registerSchema = z.object({ email: z.string().max(254), name: z.string().max(100), password: z.string().max(200), orgName: z.string().max(100).optional() });
const loginSchema = z.object({ email: z.string().max(254), password: z.string().max(200) });

async function startSession(userId: string, orgId: string) {
  const { token, expiresAt } = await createSession(userId, orgId);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
    maxAge: SESSION_DAYS * 86400,
  });
}

const ip = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";

export async function POST(req: Request, { params }: { params: Promise<{ action: string }> }) {
  try {
    const { action } = await params;
    const origin = req.headers.get("origin");
    if (origin && new URL(origin).host !== req.headers.get("host")) throw new AuthError("Cross-origin request rejected.", 403);

    if (action === "logout") {
      const jar = await cookies();
      await destroySession(jar.get(SESSION_COOKIE)?.value);
      jar.delete(SESSION_COOKIE);
      return Response.json({ ok: true });
    }
    if (action === "login") {
      const body = loginSchema.parse(await req.json());
      const rl = rateLimit(`login:${ip(req)}:${body.email.toLowerCase()}`, 8, 15 * 60_000);
      if (!rl.ok) throw new AuthError(`Too many attempts. Try again in ${Math.ceil(rl.retryAfterSec / 60)} min.`, 429);
      const { userId, orgId } = await authenticate(body.email, body.password);
      await startSession(userId, orgId);
      return Response.json({ ok: true });
    }
    if (action === "register") {
      const body = registerSchema.parse(await req.json());
      const rl = rateLimit(`register:${ip(req)}`, 5, 60 * 60_000);
      if (!rl.ok) throw new AuthError("Too many sign-ups from this address. Try again later.", 429);
      const { userId, orgId } = await registerUser(body);
      await startSession(userId, orgId);
      return Response.json({ ok: true });
    }
    if (action === "me") return Response.json({ user: await getAuth() });
    return Response.json({ error: "Not found" }, { status: 404 });
  } catch (e) {
    return errorResponse(e);
  }
}
