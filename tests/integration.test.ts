import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { authenticate, createSession, destroySession, hasRole, registerUser, resolveSession } from "@/lib/auth/service";
import { cancelSearch, startSearch } from "@/lib/search/runner";
import type { Connector, DiscoverContext, RawLead } from "@/lib/connectors/types";
import type { WebsiteAudit } from "@/lib/enrich/website-audit";

const { leads, leadSources, searches, searchEvents, mergeCandidates, apiUsage } = schema;

// ---- test doubles (clearly synthetic; never shown in the product) ----
function mock(id: string, discover: (ctx: DiscoverContext) => Promise<RawLead[]>, configured = true): Connector {
  return {
    info: { id, name: id, kind: "discovery", status: "live_tested", summary: "", returns: [], cost: "", requiresKey: !configured, limits: "", freshness: "", regions: "", compliance: "" },
    isConfigured: () => configured,
    setupMessage: () => (configured ? null : "needs KEY"),
    discover,
  };
}
const rec = (o: Partial<RawLead> & { name: string; sourceRecordId: string; source: string }): RawLead => ({ matchBasis: "tag", nicheId: "healthcare-and-medical.dental-clinics", ...o });

const A = rec({ source: "osm", sourceRecordId: "node/1", name: "Fixture Dental Arts", lat: 40.68, lng: -73.95, phone: "+1 718 622 8950", website: "https://fixture-dental.test", address: "1 Test St" });
const A2 = rec({ source: "google_places", sourceRecordId: "g1", name: "Fixture Dental Arts LLC", lat: 40.68002, lng: -73.95001, phone: "(718) 622-8950", rating: 4.8, reviewCount: 120, website: "https://fixture-dental.test" });
const B = rec({ source: "osm", sourceRecordId: "node/2", name: "Second Smiles", lat: 40.7, lng: -73.9, phone: "+1 718 555 0101" });
const LOWRATED = rec({ source: "google_places", sourceRecordId: "g3", name: "Meh Dental", lat: 40.69, lng: -73.94, phone: "+1 718 555 0102", rating: 2.1, reviewCount: 3 });
const NOCONTACT = rec({ source: "osm", sourceRecordId: "node/4", name: "Ghost Dental", lat: 40.69, lng: -73.93 });

const okAudit = (url: string): WebsiteAudit => ({
  url, finalUrl: url, checkedAt: new Date().toISOString(), reachable: "detected", https: "detected", robotsAllowed: true, responseMs: 300,
  signals: { viewport: "detected", contactForm: "detected", booking: "not_detected", onlineOrdering: "not_detected", chat: "not_detected", crmOrMarketing: "not_detected", structuredData: "detected", legacyMarkup: "not_detected", copyrightYear: new Date().getFullYear() },
  brokenLinks: { checked: 2, broken: [] },
  contacts: { emails: [{ email: "hello@fixture-dental.test", url: url + "/contact" }], phones: [], social: { facebook: "https://www.facebook.com/fixture" } },
  notes: [],
});
const deps = (connectors: Connector[]) => ({
  getConnector: (id: string) => connectors.find((c) => c.info.id === id),
  auditWebsite: async (u: string) => okAudit(u),
  checkEmail: async (e: string) => ({ email: e, status: "domain_verified" as const, reasons: [] }),
});

const baseCfg = (sources: string[], extra: Record<string, unknown> = {}) => ({
  nicheIds: ["healthcare-and-medical.dental-clinics"],
  location: { label: "Brooklyn, New York, United States", lat: 40.6782, lng: -73.9442, countryCode: "us" },
  radius: { value: 10, unit: "km" },
  sources, strategy: "balanced", enrichWebsites: true, ...extra,
});

let orgId: string, userId: string, otherOrg: string;
beforeAll(async () => {
  ({ orgId, userId } = await registerUser({ email: "owner@fixture.test", name: "Owner", password: "correct-horse-9" }));
  ({ orgId: otherOrg } = await registerUser({ email: "other@fixture.test", name: "Other", password: "correct-horse-9" }));
});

describe("authentication & sessions", () => {
  it("rejects weak passwords, bad emails and duplicate accounts", async () => {
    await expect(registerUser({ email: "x@y.test", name: "X", password: "short" })).rejects.toThrow(/at least 10/);
    await expect(registerUser({ email: "nope", name: "X", password: "correct-horse-9" })).rejects.toThrow(/valid email/);
    await expect(registerUser({ email: "OWNER@fixture.test", name: "X", password: "correct-horse-9" })).rejects.toThrow(/already exists/);
  });
  it("authenticates, creates, resolves and destroys sessions", async () => {
    await expect(authenticate("owner@fixture.test", "wrong-password-1")).rejects.toThrow(/Invalid/);
    await expect(authenticate("ghost@fixture.test", "whatever-123")).rejects.toThrow(/Invalid/);
    const a = await authenticate("owner@fixture.test", "correct-horse-9");
    const { token } = await createSession(a.userId, a.orgId);
    const ctx = await resolveSession(token);
    expect(ctx).toMatchObject({ email: "owner@fixture.test", role: "owner", orgId });
    expect(hasRole(ctx!, "admin")).toBe(true);
    await destroySession(token);
    expect(await resolveSession(token)).toBeNull();
    expect(await resolveSession("garbage")).toBeNull();
  });
  it("seeds the 10 default pipeline stages", async () => {
    const db = await getDb();
    const st = await db.select().from(schema.pipelineStages).where(eq(schema.pipelineStages.orgId, orgId));
    expect(st).toHaveLength(10);
  });
});

describe("search pipeline", () => {
  it("discovers, filters, merges across sources, enriches, scores and keeps provenance", async () => {
    const osm = mock("osm", async () => [A, B, NOCONTACT]);
    const goog = mock("google_places", async () => [A2, LOWRATED]);
    const id = await startSearch(
      orgId, userId,
      baseCfg(["osm", "google_places"], { filters: { minRating: 4, website: "any", requirePhone: false, requireEmail: false, opportunities: [] } }),
      { deps: deps([osm, goog]), await: true },
    );
    const db = await getDb();
    const [s] = await db.select().from(searches).where(eq(searches.id, id));
    expect(s.status).toBe("completed");
    const st = s.stats as Record<string, number>;
    expect(st.discovered).toBe(5);
    expect(st.duplicatesMerged).toBe(1); // A + A2 merged across sources
    expect(st.newLeads).toBe(2); // Fixture Dental Arts + Second Smiles (Meh filtered by rating, Ghost has no contact route)

    const rows = await db.select().from(leads).where(eq(leads.orgId, orgId));
    // merged lead is named by the most reliable source (Google over OSM)
    expect(rows.map((r) => r.name).sort()).toEqual(["Fixture Dental Arts LLC", "Second Smiles"]);
    const fixture = rows.find((r) => r.name === "Fixture Dental Arts LLC")!;
    expect(fixture.sourceCount).toBe(2);
    expect(fixture.rating).toBe(4.8);
    expect(fixture.phoneE164).toBe("+17186228950");
    expect(fixture.email).toBe("hello@fixture-dental.test"); // published on the site, with provenance
    expect(fixture.emailSourceUrl).toContain("/contact");
    expect(fixture.websiteStatus).toBe("reachable");
    expect(fixture.verificationStatus).toBe("verified");
    expect(fixture.score).toBeGreaterThan(50);
    expect((fixture.scoreBreakdown as { components: unknown[] }).components).toHaveLength(6);
    const srcs = await db.select().from(leadSources).where(eq(leadSources.leadId, fixture.id));
    expect(srcs.map((x) => x.source).sort()).toEqual(["google_places", "osm", "website"]);
    const second = rows.find((r) => r.name === "Second Smiles")!;
    expect(second.email).toBeNull(); // never invented
    expect(second.websiteStatus).toBe("none");
    // usage tracking only counts requests connectors report (mocks report none)
    expect((await db.select().from(apiUsage).where(eq(apiUsage.orgId, orgId))).length).toBe(0);
  });

  it("re-running the same search does not duplicate leads", async () => {
    const db = await getDb();
    const before = (await db.select().from(leads).where(eq(leads.orgId, orgId))).length;
    const osm = mock("osm", async () => [A, B]);
    const id = await startSearch(orgId, userId, baseCfg(["osm"]), { deps: deps([osm]), await: true });
    const [s] = await db.select().from(searches).where(eq(searches.id, id));
    expect((s.stats as Record<string, number>).newLeads).toBe(0);
    expect((s.stats as Record<string, number>).updatedExisting).toBe(2);
    expect((await db.select().from(leads).where(eq(leads.orgId, orgId))).length).toBe(before);
  });

  it("isolates tenants: another org's identical search creates its own leads", async () => {
    const osm = mock("osm", async () => [A]);
    const other = await registerUser({ email: "third@fixture.test", name: "T", password: "correct-horse-9" });
    await startSearch(other.orgId, other.userId, baseCfg(["osm"]), { deps: deps([osm]), await: true });
    const db = await getDb();
    expect((await db.select().from(leads).where(eq(leads.orgId, other.orgId))).length).toBe(1);
    expect((await db.select().from(leads).where(eq(leads.orgId, otherOrg))).length).toBe(0);
  });

  it("one failing source does not stop the others; the failure is logged", async () => {
    const bad = mock("google_places", async () => { throw new Error("quota exceeded"); });
    const good = mock("osm", async () => [rec({ source: "osm", sourceRecordId: "node/9", name: "Survivor Dental", lat: 40.65, lng: -73.97, phone: "+1 718 555 0199" })]);
    const db = await getDb();
    const id = await startSearch(orgId, userId, baseCfg(["osm", "google_places"], { enrichWebsites: false }), { deps: deps([good, bad]), await: true });
    const [s] = await db.select().from(searches).where(eq(searches.id, id));
    expect(s.status).toBe("completed");
    const st = s.stats as { newLeads: number; bySource: Record<string, { errors: number }> };
    expect(st.newLeads).toBe(1);
    expect(st.bySource.google_places.errors).toBe(1);
    const ev = await db.select().from(searchEvents).where(eq(searchEvents.searchId, id));
    expect(ev.some((e) => e.level === "error" && /quota exceeded/.test(e.message))).toBe(true);
  });

  it("fails honestly when every source fails or none are configured", async () => {
    const bad = mock("osm", async () => { throw new Error("boom"); });
    const db = await getDb();
    const id = await startSearch(orgId, userId, baseCfg(["osm"]), { deps: deps([bad]), await: true });
    const [s] = await db.select().from(searches).where(eq(searches.id, id));
    expect(s.status).toBe("failed");
    expect(s.error).toMatch(/Every selected source failed/);

    const unconfigured = mock("google_places", async () => [], false);
    const id2 = await startSearch(orgId, userId, baseCfg(["google_places"]), { deps: deps([unconfigured]), await: true });
    const [s2] = await db.select().from(searches).where(eq(searches.id, id2));
    expect(s2.status).toBe("failed");
    const ev = await db.select().from(searchEvents).where(eq(searchEvents.searchId, id2));
    expect(ev.some((e) => /needs KEY/.test(e.message))).toBe(true);
  });

  it("can be cancelled while a source is running", async () => {
    const slow = mock("osm", (ctx) => new Promise((_, reject) => ctx.signal.addEventListener("abort", () => reject(new Error("aborted")))));
    const db = await getDb();
    const job = startSearch(orgId, userId, baseCfg(["osm"]), { deps: deps([slow]), await: true });
    let id = "";
    for (let i = 0; i < 100 && !id; i++) {
      await new Promise((r) => setTimeout(r, 50));
      const [r] = await db.select().from(searches).where(eq(searches.status, "running"));
      if (r) id = r.id;
    }
    expect(id).not.toBe("");
    expect(await cancelSearch(otherOrg, id)).toBe(false); // other tenants cannot cancel it
    expect(await cancelSearch(orgId, id)).toBe(true);
    await job;
    const [s] = await db.select().from(searches).where(eq(searches.id, id));
    expect(s.status).toBe("cancelled");
    expect(await cancelSearch(orgId, id)).toBe(false); // already finished
  });

  it("queues uncertain duplicates for manual review instead of auto-merging", async () => {
    const db = await getDb();
    // Similar names, close together, but only one has a phone: not enough evidence to merge.
    const x1 = rec({ source: "osm", sourceRecordId: "n/r1", name: "Harbor View Dental", lat: 40.7001, lng: -73.9001, phone: "+1 718 555 0300" });
    const x2 = rec({ source: "google_places", sourceRecordId: "g-r2", name: "Harbour View Dentistry", lat: 40.70012, lng: -73.90013, website: "https://harbourview.test" });
    const id = await startSearch(
      orgId, userId, baseCfg(["osm", "google_places"], { enrichWebsites: false }),
      { deps: deps([mock("osm", async () => [x1]), mock("google_places", async () => [x2])]), await: true },
    );
    const [s] = await db.select().from(searches).where(eq(searches.id, id));
    const st = s.stats as Record<string, number>;
    expect(st.newLeads).toBe(2); // both kept — not merged
    expect(st.uncertainDuplicates).toBe(1);
    const cands = await db.select().from(mergeCandidates).where(eq(mergeCandidates.orgId, orgId));
    expect(cands).toHaveLength(1);
    expect(cands[0].status).toBe("pending");
  });
});
