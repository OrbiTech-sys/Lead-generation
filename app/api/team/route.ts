import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { api } from "@/lib/auth/guard";
import { hashPassword, newToken } from "@/lib/auth/password";
import { getDb, schema } from "@/lib/db";

const { memberships, users, auditLogs, leads } = schema;

export const GET = api(async (_req, ctx) => {
  const db = await getDb();
  const members = await db
    .select({ userId: users.id, name: users.name, email: users.email, role: memberships.role, joined: memberships.createdAt, assigned: sql<number>`(select count(*)::int from ${leads} where ${leads.assignedTo} = ${users.id} and ${leads.orgId} = ${ctx.orgId})` })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, ctx.orgId));
  return { members, me: ctx.userId, myRole: ctx.role };
});

const ROLES = ["admin", "member", "viewer"] as const;

/** No email infrastructure yet: admins create the account and hand over a one-time temporary password. */
export const POST = api(async (req, ctx) => {
  const b = z.object({ email: z.string().email().max(254), name: z.string().trim().min(1).max(100), role: z.enum(ROLES) }).parse(await req.json());
  const db = await getDb();
  const email = b.email.toLowerCase();
  const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (exists) return Response.json({ error: "That email already has an account. Invitations for existing accounts are not supported yet." }, { status: 409 });
  const temp = newToken().slice(0, 14) + "9a";
  const [u] = await db.insert(users).values({ email, name: b.name, passwordHash: await hashPassword(temp) }).returning({ id: users.id });
  await db.insert(memberships).values({ orgId: ctx.orgId, userId: u.id, role: b.role });
  await db.insert(auditLogs).values({ orgId: ctx.orgId, userId: ctx.userId, action: "team.add", detail: { email, role: b.role } });
  return { ok: true, temporaryPassword: temp, note: "Shown once. Ask the member to sign in and keep it safe." };
}, { role: "admin" });

async function ownerCount(orgId: string) {
  const db = await getDb();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.role, "owner")));
  return n;
}

export const PATCH = api(async (req, ctx) => {
  const b = z.object({ userId: z.string().uuid(), role: z.enum(["owner", ...ROLES]) }).parse(await req.json());
  const db = await getDb();
  const [m] = await db.select().from(memberships).where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, b.userId)));
  if (!m) return Response.json({ error: "Member not found." }, { status: 404 });
  if ((b.role === "owner" || m.role === "owner") && ctx.role !== "owner") return Response.json({ error: "Only an owner can change owner roles." }, { status: 403 });
  if (m.role === "owner" && b.role !== "owner" && (await ownerCount(ctx.orgId)) <= 1) return Response.json({ error: "A workspace needs at least one owner." }, { status: 400 });
  await db.update(memberships).set({ role: b.role }).where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, b.userId)));
  await db.insert(auditLogs).values({ orgId: ctx.orgId, userId: ctx.userId, action: "team.role", detail: b });
  return { ok: true };
}, { role: "admin" });

export const DELETE = api(async (req, ctx) => {
  const b = z.object({ userId: z.string().uuid() }).parse(await req.json());
  const db = await getDb();
  const [m] = await db.select().from(memberships).where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, b.userId)));
  if (!m) return Response.json({ error: "Member not found." }, { status: 404 });
  if (m.role === "owner" && (ctx.role !== "owner" || (await ownerCount(ctx.orgId)) <= 1)) return Response.json({ error: "Cannot remove this owner." }, { status: 400 });
  await db.update(leads).set({ assignedTo: null }).where(and(eq(leads.orgId, ctx.orgId), eq(leads.assignedTo, b.userId)));
  await db.delete(memberships).where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, b.userId)));
  await db.delete(schema.sessions).where(and(eq(schema.sessions.userId, b.userId), eq(schema.sessions.orgId, ctx.orgId)));
  await db.insert(auditLogs).values({ orgId: ctx.orgId, userId: ctx.userId, action: "team.remove", detail: b });
  return { ok: true };
}, { role: "admin" });
