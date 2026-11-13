import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { api } from "@/lib/auth/guard";
import { getDb, schema } from "@/lib/db";
import { normalizeWeights } from "@/lib/scoring/score";
import { DEFAULT_WEIGHTS } from "@/lib/scoring/types";
import { rescoreAll } from "@/lib/services/verify-lead";

const { organizations, pipelineStages, suppressions, auditLogs, leads } = schema;

export const GET = api(async (_req, ctx) => {
  const db = await getDb();
  const [org] = await db.select().from(organizations).where(eq(organizations.id, ctx.orgId));
  const stages = await db.select().from(pipelineStages).where(eq(pipelineStages.orgId, ctx.orgId)).orderBy(asc(pipelineStages.position));
  const sup = await db.select().from(suppressions).where(eq(suppressions.orgId, ctx.orgId));
  return {
    org: { id: org.id, name: org.name, plan: org.plan, dailySearchQuota: org.dailySearchQuota },
    weights: normalizeWeights(org.scoringWeights as never),
    defaultWeights: DEFAULT_WEIGHTS,
    stages,
    suppressions: sup,
    role: ctx.role,
    ai: { enabled: false, note: "Local-model features (review analysis, classification) are not implemented in this build. All scoring and opportunity detection is rule-based and explainable." },
  };
});

const patchSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  weights: z.object({ contact: z.number().min(0).max(100), source: z.number().min(0).max(100), relevance: z.number().min(0).max(100), digital: z.number().min(0).max(100), freshness: z.number().min(0).max(100), activity: z.number().min(0).max(100) }).optional(),
  stages: z.array(z.object({ key: z.string().regex(/^[a-z0-9_]{1,40}$/), label: z.string().trim().min(1).max(40), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) })).min(2).max(20).optional(),
  rescore: z.boolean().optional(),
});

export const PATCH = api(async (req, ctx) => {
  const b = patchSchema.parse(await req.json());
  const db = await getDb();
  if (b.name) await db.update(organizations).set({ name: b.name }).where(eq(organizations.id, ctx.orgId));
  if (b.weights) {
    if (Object.values(b.weights).reduce((a, c) => a + c, 0) <= 0) return Response.json({ error: "At least one weight must be above zero." }, { status: 400 });
    await db.update(organizations).set({ scoringWeights: b.weights }).where(eq(organizations.id, ctx.orgId));
  }
  if (b.stages) {
    const keys = new Set(b.stages.map((s) => s.key));
    if (keys.size !== b.stages.length) return Response.json({ error: "Stage keys must be unique." }, { status: 400 });
    // Leads in a removed stage move to the first stage so none are orphaned.
    const existing = await db.select().from(pipelineStages).where(eq(pipelineStages.orgId, ctx.orgId));
    for (const old of existing.filter((e) => !keys.has(e.key))) {
      await db.update(leads).set({ status: b.stages[0].key }).where(and(eq(leads.orgId, ctx.orgId), eq(leads.status, old.key)));
      await db.delete(pipelineStages).where(eq(pipelineStages.id, old.id));
    }
    for (const [i, s] of b.stages.entries()) {
      await db.insert(pipelineStages).values({ orgId: ctx.orgId, position: i, ...s }).onConflictDoUpdate({ target: [pipelineStages.orgId, pipelineStages.key], set: { position: i, label: s.label, color: s.color } });
    }
  }
  let rescored = 0;
  if (b.weights || b.rescore) rescored = await rescoreAll(ctx.orgId);
  await db.insert(auditLogs).values({ orgId: ctx.orgId, userId: ctx.userId, action: "settings.update", detail: { keys: Object.keys(b) } });
  return { ok: true, rescored };
}, { role: "admin" });

const supSchema = z.object({ type: z.enum(["email", "phone", "domain"]), value: z.string().trim().min(3).max(200), reason: z.string().trim().max(200).optional() });

export const POST = api(async (req, ctx) => {
  const b = supSchema.parse(await req.json());
  const db = await getDb();
  let value = b.value.toLowerCase();
  if (b.type === "domain") value = value.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  if (b.type === "phone") {
    const { checkPhone } = await import("@/lib/verify/phone");
    const p = checkPhone(b.value);
    if (!p?.e164) return Response.json({ error: "Enter the phone number in international format (e.g. +14155550123)." }, { status: 400 });
    value = p.e164;
  }
  await db.insert(suppressions).values({ orgId: ctx.orgId, type: b.type, value, reason: b.reason ?? null }).onConflictDoNothing();
  // flag matching leads immediately
  const col = b.type === "email" ? leads.email : b.type === "phone" ? leads.phoneE164 : leads.websiteDomain;
  await db.update(leads).set({ doNotContact: true }).where(and(eq(leads.orgId, ctx.orgId), eq(col, value)));
  await db.insert(auditLogs).values({ orgId: ctx.orgId, userId: ctx.userId, action: "suppression.add", detail: { type: b.type } });
  return { ok: true };
});

export const DELETE = api(async (req, ctx) => {
  const b = z.object({ id: z.string().uuid() }).parse(await req.json());
  const db = await getDb();
  await db.delete(suppressions).where(and(eq(suppressions.id, b.id), eq(suppressions.orgId, ctx.orgId)));
  return { ok: true };
}, { role: "admin" });
