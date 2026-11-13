import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { api } from "@/lib/auth/guard";
import { getDb, schema } from "@/lib/db";
import { mergeLeads, undoMerge } from "@/lib/services/merge";

const { leads, mergeCandidates, mergeHistory } = schema;

const brief = (l: typeof leads.$inferSelect) => ({ id: l.id, name: l.name, address: l.address, city: l.city, phone: l.phone, email: l.email, website: l.website, lat: l.lat, lng: l.lng, score: l.score, sourceCount: l.sourceCount, sourcePrimary: l.sourcePrimary, status: l.status });

export const GET = api(async (_req, ctx) => {
  const db = await getDb();
  const cands = await db.select().from(mergeCandidates).where(and(eq(mergeCandidates.orgId, ctx.orgId), eq(mergeCandidates.status, "pending"))).orderBy(desc(mergeCandidates.confidence)).limit(100);
  const ids = [...new Set(cands.flatMap((c) => [c.leadAId, c.leadBId]))];
  const rows = ids.length ? await db.select().from(leads).where(and(eq(leads.orgId, ctx.orgId), inArray(leads.id, ids))) : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const history = await db.select().from(mergeHistory).where(eq(mergeHistory.orgId, ctx.orgId)).orderBy(desc(mergeHistory.createdAt)).limit(30);
  return {
    candidates: cands.flatMap((c) => {
      const a = byId.get(c.leadAId);
      const b = byId.get(c.leadBId);
      return a && b ? [{ id: c.id, confidence: c.confidence, reasons: c.reasons, a: brief(a), b: brief(b) }] : [];
    }),
    history: history.map((h) => ({ id: h.id, mode: h.mode, confidence: h.confidence, undone: h.undone, createdAt: h.createdAt, mergedName: (h.mergedSnapshot as { loser: { name: string } }).loser.name, survivorId: h.survivorId })),
  };
});

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("merge"), candidateId: z.string().uuid(), survivorId: z.string().uuid() }),
  z.object({ action: z.literal("reject"), candidateId: z.string().uuid() }),
  z.object({ action: z.literal("undo"), historyId: z.string().uuid() }),
]);

export const POST = api(async (req, ctx) => {
  const b = actionSchema.parse(await req.json());
  const db = await getDb();
  if (b.action === "undo") return undoMerge(ctx.orgId, b.historyId);
  const [c] = await db.select().from(mergeCandidates).where(and(eq(mergeCandidates.id, b.candidateId), eq(mergeCandidates.orgId, ctx.orgId)));
  if (!c || c.status !== "pending") return Response.json({ error: "Candidate not found or already resolved." }, { status: 404 });
  if (b.action === "reject") {
    await db.update(mergeCandidates).set({ status: "rejected" }).where(eq(mergeCandidates.id, c.id));
    return { ok: true };
  }
  if (![c.leadAId, c.leadBId].includes(b.survivorId)) return Response.json({ error: "Survivor must be one of the two leads." }, { status: 400 });
  const loser = b.survivorId === c.leadAId ? c.leadBId : c.leadAId;
  const historyId = await mergeLeads(ctx.orgId, b.survivorId, loser, "manual", c.confidence);
  return { ok: true, historyId };
});
