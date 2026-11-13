import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb, schema, type Db } from "../db";
import { hashPassword, newToken, passwordProblem, sha256, verifyPassword } from "./password";

const { users, organizations, memberships, sessions, pipelineStages, auditLogs } = schema;

export const DEFAULT_STAGES: { key: string; label: string; color: string }[] = [
  { key: "new", label: "New", color: "#64748b" },
  { key: "discovered", label: "Discovered", color: "#6366f1" },
  { key: "verified", label: "Verified", color: "#0ea5e9" },
  { key: "qualified", label: "Qualified", color: "#14b8a6" },
  { key: "contacted", label: "Contacted", color: "#f59e0b" },
  { key: "follow_up", label: "Follow-up", color: "#f97316" },
  { key: "interested", label: "Interested", color: "#22c55e" },
  { key: "proposal_sent", label: "Proposal Sent", color: "#8b5cf6" },
  { key: "converted", label: "Converted", color: "#16a34a" },
  { key: "not_interested", label: "Not Interested", color: "#ef4444" },
];

export const SESSION_DAYS = 14;

export class AuthError extends Error {
  constructor(message: string, public status = 401) {
    super(message);
  }
}

export async function seedOrganization(db: Db, orgId: string) {
  await db.insert(pipelineStages).values(DEFAULT_STAGES.map((s, i) => ({ orgId, position: i, ...s }))).onConflictDoNothing();
}

export async function registerUser(input: { email: string; name: string; password: string; orgName?: string }) {
  const db = await getDb();
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) throw new AuthError("Enter a valid email address.", 400);
  const name = input.name.trim().slice(0, 100);
  if (!name) throw new AuthError("Name is required.", 400);
  const problem = passwordProblem(input.password);
  if (problem) throw new AuthError(problem, 400);
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (existing) throw new AuthError("An account with this email already exists.", 409);

  const passwordHash = await hashPassword(input.password);
  const [user] = await db.insert(users).values({ email, name, passwordHash }).returning({ id: users.id });
  const [org] = await db
    .insert(organizations)
    .values({ name: (input.orgName?.trim() || `${name}'s workspace`).slice(0, 100) })
    .returning({ id: organizations.id });
  await db.insert(memberships).values({ orgId: org.id, userId: user.id, role: "owner" });
  await seedOrganization(db, org.id);
  await db.insert(auditLogs).values({ orgId: org.id, userId: user.id, action: "user.register" });
  return { userId: user.id as string, orgId: org.id as string };
}

export async function authenticate(emailIn: string, password: string) {
  const db = await getDb();
  const email = emailIn.trim().toLowerCase();
  const [user] = await db.select().from(users).where(eq(users.email, email));
  // Always run a hash comparison so timing doesn't reveal whether the account exists.
  const dummy = "scrypt$32768$AAAAAAAAAAAAAAAAAAAAAA==$" + Buffer.alloc(64).toString("base64");
  const ok = await verifyPassword(password, user?.passwordHash ?? dummy);
  if (!user || !ok) throw new AuthError("Invalid email or password.", 401);
  const [m] = await db.select().from(memberships).where(eq(memberships.userId, user.id)).limit(1);
  if (!m) throw new AuthError("This account has no workspace.", 403);
  await db.insert(auditLogs).values({ orgId: m.orgId, userId: user.id, action: "user.login" });
  return { userId: user.id as string, orgId: m.orgId as string };
}

export async function createSession(userId: string, orgId: string) {
  const db = await getDb();
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(sessions).values({ id: sha256(token), userId, orgId, expiresAt });
  return { token, expiresAt };
}

export interface AuthContext {
  userId: string;
  orgId: string;
  email: string;
  name: string;
  role: "owner" | "admin" | "member" | "viewer";
  orgName: string;
}

export async function resolveSession(token: string | undefined): Promise<AuthContext | null> {
  if (!token) return null;
  const db = await getDb();
  const [s] = await db.select().from(sessions).where(eq(sessions.id, sha256(token)));
  if (!s) return null;
  if (s.expiresAt.getTime() < Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, s.id));
    return null;
  }
  const [row] = await db
    .select({ email: users.email, name: users.name, role: memberships.role, orgName: organizations.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(and(eq(memberships.userId, s.userId), eq(memberships.orgId, s.orgId)));
  if (!row) return null;
  return { userId: s.userId, orgId: s.orgId, email: row.email, name: row.name, role: row.role as AuthContext["role"], orgName: row.orgName };
}

export async function destroySession(token: string | undefined) {
  if (!token) return;
  const db = await getDb();
  await db.delete(sessions).where(eq(sessions.id, sha256(token)));
}

const ORDER = { viewer: 0, member: 1, admin: 2, owner: 3 } as const;
export const hasRole = (ctx: AuthContext, min: keyof typeof ORDER) => ORDER[ctx.role] >= ORDER[min];
