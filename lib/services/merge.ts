import "server-only";
import { and, eq, inArray, or } from "drizzle-orm";
import { getDb, schema } from "../db";
import { intelligenceFor, rowToFacts, type LeadRow } from "../search/facts";

const { leads, leadSources, leadActivities, listItems, mergeCandidates, mergeHistory, organizations } = schema;

/**
 * Merge `loser` into `survivor`: sources, notes and list memberships move to the survivor, gaps in the survivor
 * are filled from the loser (survivor values win), and a full snapshot is stored so the merge can be undone.
 */
export async function mergeLeads(orgId: string, survivorId: string, loserId: string, mode: "auto" | "manual", confidence?: number) {
  const db = await getDb();
  const [survivor] = await db.select().from(leads).where(and(eq(leads.id, survivorId), eq(leads.orgId, orgId)));
  const [loser] = await db.select().from(leads).where(and(eq(leads.id, loserId), eq(leads.orgId, orgId)));
  if (!survivor || !loser || survivor.id === loser.id) throw new Error("Both leads must exist in your workspace.");

  const loserSources = await db.select().from(leadSources).where(eq(leadSources.leadId, loser.id));
  const loserActs = await db.select().from(leadActivities).where(eq(leadActivities.leadId, loser.id));
  const loserLists = await db.select().from(listItems).where(eq(listItems.leadId, loser.id));
  const snapshot = {
    loser, loserSources, loserActs, loserLists,
    survivorBefore: survivor,
    affectedCandidates: await db.select().from(mergeCandidates).where(or(eq(mergeCandidates.leadAId, loser.id), eq(mergeCandidates.leadBId, loser.id))),
  };

  const fillable = ["address", "postcode", "city", "state", "phone", "phoneE164", "phoneType", "email", "emailSourceUrl", "website", "websiteDomain", "mapsUrl", "rating", "reviewCount", "facebook", "instagram", "linkedin", "description", "contactPerson", "contactPosition", "openingHours", "businessStatus", "lat", "lng"] as const;
  const patch: Record<string, unknown> = {};
  for (const k of fillable) if ((survivor[k] == null || survivor[k] === "") && loser[k] != null) patch[k] = loser[k];
  if (!survivor.phoneE164 && loser.phoneE164) Object.assign(patch, { phoneStatus: loser.phoneStatus });
  if (!survivor.email && loser.email) Object.assign(patch, { emailStatus: loser.emailStatus });
  if (!survivor.websiteAudit && loser.websiteAudit) Object.assign(patch, { websiteAudit: loser.websiteAudit, websiteStatus: loser.websiteStatus });
  patch.tags = [...new Set([...survivor.tags, ...loser.tags])];
  patch.doNotContact = survivor.doNotContact || loser.doNotContact;

  // Move provenance to the survivor. A source record the survivor already has is an exact duplicate: drop it.
  const survivorKeys = new Set(
    (await db.select().from(leadSources).where(eq(leadSources.leadId, survivor.id))).map((s) => `${s.source}|${s.sourceRecordId}`),
  );
  for (const s of loserSources) {
    if (survivorKeys.has(`${s.source}|${s.sourceRecordId}`)) await db.delete(leadSources).where(eq(leadSources.id, s.id));
    else await db.update(leadSources).set({ leadId: survivor.id }).where(eq(leadSources.id, s.id));
  }
  await db.update(leadActivities).set({ leadId: survivor.id }).where(eq(leadActivities.leadId, loser.id));
  for (const li of loserLists) await db.insert(listItems).values({ listId: li.listId, leadId: survivor.id }).onConflictDoNothing();

  const srcs = await db.select({ s: leadSources.source }).from(leadSources).where(eq(leadSources.leadId, survivor.id));
  const distinct = [...new Set(srcs.map((x) => x.s))];
  const merged = { ...survivor, ...patch } as LeadRow;
  const [org] = await db.select({ w: organizations.scoringWeights }).from(organizations).where(eq(organizations.id, orgId));
  const intel = intelligenceFor(rowToFacts(merged, distinct), org?.w as never);
  await db.update(leads).set({ ...patch, sourceCount: distinct.length, ...intel, updatedAt: new Date() }).where(eq(leads.id, survivor.id));

  // Resolve pending candidates involving either lead, then remove the loser.
  await db.update(mergeCandidates).set({ status: "merged" }).where(and(eq(mergeCandidates.orgId, orgId), or(and(eq(mergeCandidates.leadAId, survivor.id), eq(mergeCandidates.leadBId, loser.id)), and(eq(mergeCandidates.leadAId, loser.id), eq(mergeCandidates.leadBId, survivor.id)))));
  await db.delete(mergeCandidates).where(and(inArray(mergeCandidates.status, ["pending"]), or(eq(mergeCandidates.leadAId, loser.id), eq(mergeCandidates.leadBId, loser.id))));
  await db.delete(leads).where(eq(leads.id, loser.id));
  const [h] = await db.insert(mergeHistory).values({ orgId, survivorId, mergedSnapshot: snapshot, mode, confidence: confidence ?? null }).returning({ id: mergeHistory.id });
  return h.id as string;
}

/** Restore the merged-away lead and the survivor's original state from the stored snapshot. */
export async function undoMerge(orgId: string, historyId: string) {
  const db = await getDb();
  const [h] = await db.select().from(mergeHistory).where(and(eq(mergeHistory.id, historyId), eq(mergeHistory.orgId, orgId)));
  if (!h) throw new Error("Merge record not found.");
  if (h.undone) throw new Error("This merge was already undone.");
  const snap = h.mergedSnapshot as {
    loser: Record<string, unknown>; loserSources: Record<string, unknown>[]; loserActs: Record<string, unknown>[];
    loserLists: Record<string, unknown>[]; survivorBefore: Record<string, unknown>;
  };
  const revive = (o: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) && /(At|at)$/.test(k) ? new Date(v) : v]));

  const loser = revive(snap.loser) as typeof leads.$inferInsert;
  await db.insert(leads).values(loser).onConflictDoNothing();
  for (const s of snap.loserSources) {
    const moved = await db.update(leadSources).set({ leadId: loser.id as string }).where(eq(leadSources.id, s.id as string)).returning({ id: leadSources.id });
    if (!moved.length) {
      // it was dropped as an exact duplicate during the merge: put it back
      await db.insert(leadSources).values(revive(s) as typeof leadSources.$inferInsert).onConflictDoNothing();
    }
  }
  for (const a of snap.loserActs) await db.update(leadActivities).set({ leadId: loser.id as string }).where(eq(leadActivities.id, a.id as string));
  for (const li of snap.loserLists) await db.insert(listItems).values({ listId: li.listId as string, leadId: loser.id as string }).onConflictDoNothing();
  const before = revive(snap.survivorBefore) as typeof leads.$inferInsert;
  const { id: _id, orgId: _o, ...restore } = before;
  void _id; void _o;
  await db.update(leads).set(restore).where(eq(leads.id, h.survivorId));
  await db.update(mergeHistory).set({ undone: true }).where(eq(mergeHistory.id, h.id));
  return { restoredLeadId: loser.id as string };
}
