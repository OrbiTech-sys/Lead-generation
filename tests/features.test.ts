import ExcelJS from "exceljs";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb, schema } from "@/lib/db";
import { registerUser } from "@/lib/auth/service";
import { buildExport, safeCell, toCsv, EXPORT_COLUMNS } from "@/lib/export/export";
import { mergeLeads, undoMerge } from "@/lib/services/merge";
import { leadFilterSchema, listLeads, leadPageSchema } from "@/lib/services/leads";
import { generateOutreach, topOpportunity } from "@/lib/outreach/templates";
import { adviseSearch } from "@/lib/search/advisor";
import { searchConfigSchema } from "@/lib/search/config";
import type { Opportunity } from "@/lib/scoring/types";

const { leads, leadSources, suppressions, leadActivities } = schema;

let orgId: string;
const ids: Record<string, string> = {};

async function addLead(name: string, o: Partial<typeof leads.$inferInsert> = {}) {
  const db = await getDb();
  const [r] = await db
    .insert(leads)
    .values({ orgId, name, nameNorm: name.toLowerCase(), sourcePrimary: "osm", ...o })
    .returning({ id: leads.id });
  await db.insert(leadSources).values({ leadId: r.id, source: o.sourcePrimary ?? "osm", sourceRecordId: `rec-${name}`, sourceUrl: `https://example.test/${name.replace(/ /g, "-")}` });
  return r.id;
}

beforeAll(async () => {
  ({ orgId } = await registerUser({ email: "features@fixture.test", name: "F", password: "correct-horse-9" }));
  ids.a = await addLead("Alpha Dental", { city: "Brooklyn", country: "US", phone: "+1 718-555-0101", phoneE164: "+17185550101", email: "hi@alpha.test", website: "https://alpha.test", websiteDomain: "alpha.test", score: 80, classification: "high_priority", nicheId: "healthcare-and-medical.dental-clinics", tags: ["hot"] });
  ids.b = await addLead("=cmd|' /C calc'!A0", { city: "Queens", score: 40, classification: "moderate_potential", description: "starts with a formula char" });
  ids.c = await addLead("Gamma Roofing", { city: "Brooklyn", score: 65, classification: "good_potential", email: "x@suppressed.test", phone: "+1 718-555-0199", phoneE164: "+17185550199", websiteDomain: "gamma.test", website: "https://gamma.test" });
  ids.d = await addLead("Do Not Contact Co", { score: 90, doNotContact: true });
  ids.e = await addLead("Domain Suppressed Inc", { websiteDomain: "blocked.test", website: "https://blocked.test", score: 50 });
  const db = await getDb();
  await db.insert(suppressions).values([
    { orgId, type: "email", value: "x@suppressed.test" },
    { orgId, type: "domain", value: "blocked.test" },
    { orgId, type: "phone", value: "+17185550199" },
  ]);
});

const all = leadFilterSchema.parse({});

describe("lead filtering & sorting", () => {
  const page = (o = {}) => leadPageSchema.parse(o);
  it("filters by text, classification, city and booleans", async () => {
    expect((await listLeads(orgId, leadFilterSchema.parse({ q: "alpha" }), page())).total).toBe(1);
    expect((await listLeads(orgId, leadFilterSchema.parse({ classification: "high_priority" }), page())).total).toBe(1);
    expect((await listLeads(orgId, leadFilterSchema.parse({ city: "brooklyn" }), page())).total).toBe(2);
    expect((await listLeads(orgId, leadFilterSchema.parse({ hasEmail: "1" }), page())).total).toBe(2);
    expect((await listLeads(orgId, leadFilterSchema.parse({ tag: "hot" }), page())).rows[0].name).toBe("Alpha Dental");
    expect((await listLeads(orgId, leadFilterSchema.parse({ minScore: "60" }), page())).total).toBe(3);
  });
  it("sorts and paginates", async () => {
    const byScore = await listLeads(orgId, all, page({ sort: "score", dir: "desc", pageSize: 2 }));
    expect(byScore.rows.map((r) => r.score)).toEqual([90, 80]);
    expect(byScore.total).toBe(5);
    const p2 = await listLeads(orgId, all, page({ sort: "score", dir: "desc", pageSize: 2, page: 2 }));
    expect(p2.rows.map((r) => r.score)).toEqual([65, 50]);
    const asc = await listLeads(orgId, all, page({ sort: "name", dir: "asc" }));
    expect(asc.rows[0].nameNorm <= asc.rows[1].nameNorm).toBe(true);
  });
  it("never leaks another organisation's leads", async () => {
    const other = await registerUser({ email: "features2@fixture.test", name: "G", password: "correct-horse-9" });
    expect((await listLeads(other.orgId, all, page())).total).toBe(0);
  });
  it("opportunity filter matches the stored key", async () => {
    const db = await getDb();
    await db.update(leads).set({ opportunities: [{ key: "no_website", label: "x", certainty: "not_detected", detail: "", service: "" }] }).where(eq(leads.id, ids.b));
    expect((await listLeads(orgId, leadFilterSchema.parse({ opportunity: "no_website" }), page())).rows.map((r) => r.id)).toEqual([ids.b]);
  });
});

describe("export", () => {
  it("neutralises spreadsheet formula injection but keeps phone numbers intact", () => {
    expect(safeCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(safeCell("@cmd")).toBe("'@cmd");
    expect(safeCell("-1+1")).toBe("'-1+1");
    expect(safeCell("+17185550101")).toBe("+17185550101");
    expect(safeCell("+1 718 555 0101")).toBe("+1 718 555 0101");
    expect(safeCell(null)).toBe("");
    expect(safeCell(4.5)).toBe(4.5);
  });
  it("escapes CSV quoting and adds a BOM on request", () => {
    expect(toCsv(["a", "b"], [['x,"y"', "z\nw"]])).toBe('a,b\r\n"x,""y""","z\nw"\r\n');
    expect(toCsv(["a"], [["1"]], { bom: true }).charCodeAt(0)).toBe(0xfeff);
  });
  it("CSV: proper headers, source URLs, excludes do-not-contact and suppressed domains, blanks suppressed contacts", async () => {
    const out = await buildExport(orgId, all, "csv");
    const text = out.body as string;
    const [header, ...rows] = text.trim().split("\r\n");
    expect(header).toContain("Business Name");
    expect(header).toContain("Source URL(s)");
    expect(header).toContain("Lead Score (0-100)");
    expect(out.count).toBe(3); // 5 leads - 1 do-not-contact - 1 suppressed domain
    expect(out.excluded).toBe(2);
    expect(text).not.toContain("Do Not Contact Co");
    expect(text).not.toContain("Domain Suppressed Inc");
    expect(text).not.toContain("x@suppressed.test"); // suppressed email blanked
    expect(text).not.toContain("+17185550199"); // suppressed phone blanked
    expect(text).toContain("'=cmd|"); // formula neutralised
    expect(text).toContain("https://example.test/Alpha-Dental");
    expect(rows).toHaveLength(3);
  });
  it("respects column selection and filters (high priority only)", async () => {
    const out = await buildExport(orgId, leadFilterSchema.parse({ classification: "high_priority" }), "csv", ["name", "score"]);
    expect((out.body as string).trim().split("\r\n")).toEqual(["Business Name,Lead Score (0-100)", "Alpha Dental,80"]);
  });
  it("JSON export carries metadata and excluded count", async () => {
    const out = await buildExport(orgId, all, "json", ["name", "email"]);
    const j = JSON.parse(out.body as string);
    expect(j.count).toBe(3);
    expect(j.excludedRestricted).toBe(2);
    expect(j.leads[0]).toHaveProperty("name");
  });
  it("XLSX opens, has the right sheets, header row, and keeps phones as text", async () => {
    const out = await buildExport(orgId, all, "xlsx");
    expect(out.filename.endsWith(".xlsx")).toBe(true);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(out.body as never);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Leads", "Export info"]);
    const ws = wb.getWorksheet("Leads")!;
    expect(ws.rowCount).toBe(4);
    expect(ws.getRow(1).getCell(1).value).toBe("Business Name");
    const phoneCol = EXPORT_COLUMNS.findIndex((c) => c.key === "phone_e164") + 1;
    const alpha = [2, 3, 4].map((r) => ws.getRow(r)).find((r) => r.getCell(1).value === "Alpha Dental")!;
    expect(String(alpha.getCell(phoneCol).value)).toBe("+17185550101");
    expect(alpha.getCell(phoneCol).numFmt).toBe("@");
  });
});

describe("merge & undo", () => {
  it("merges, preserves provenance/notes, fills gaps, and can be undone", async () => {
    const db = await getDb();
    const survivor = await addLead("Merge Survivor", { phone: "+1 212-555-0100", phoneE164: "+12125550100", score: 50 });
    const loser = await addLead("Merge Survivor LLC", { email: "info@merge.test", website: "https://merge.test", websiteDomain: "merge.test", sourcePrimary: "google_places", tags: ["vip"] });
    await db.insert(leadActivities).values({ leadId: loser, orgId, type: "note", body: "called once" });

    const hid = await mergeLeads(orgId, survivor, loser, "manual", 0.8);
    const [s] = await db.select().from(leads).where(eq(leads.id, survivor));
    expect(s.email).toBe("info@merge.test"); // gap filled from the merged lead
    expect(s.phoneE164).toBe("+12125550100"); // survivor value kept
    expect(s.tags).toContain("vip");
    expect(s.sourceCount).toBe(2);
    expect((await db.select().from(leads).where(eq(leads.id, loser))).length).toBe(0);
    expect((await db.select().from(leadSources).where(eq(leadSources.leadId, survivor))).length).toBe(2);
    expect((await db.select().from(leadActivities).where(eq(leadActivities.leadId, survivor))).length).toBe(1);

    await undoMerge(orgId, hid);
    const [restored] = await db.select().from(leads).where(eq(leads.id, loser));
    expect(restored.name).toBe("Merge Survivor LLC");
    const [s2] = await db.select().from(leads).where(eq(leads.id, survivor));
    expect(s2.email).toBeNull(); // survivor back to its original state
    expect((await db.select().from(leadSources).where(eq(leadSources.leadId, loser))).length).toBe(1);
    expect((await db.select().from(leadActivities).where(eq(leadActivities.leadId, loser))).length).toBe(1);
    await expect(undoMerge(orgId, hid)).rejects.toThrow(/already undone/);
  });
  it("refuses to merge leads from another organisation", async () => {
    const other = await registerUser({ email: "features3@fixture.test", name: "H", password: "correct-horse-9" });
    await expect(mergeLeads(other.orgId, ids.a, ids.b, "manual")).rejects.toThrow(/Both leads/);
  });
});

const opp = (key: string, certainty: Opportunity["certainty"], service = "Appointment / booking automation"): Opportunity => ({ key, label: key, certainty, detail: "d", service });
const sender = { name: "Sam", company: "The OrbiTech Solution", address: "1 Main St" };

describe("outreach drafts", () => {
  it("prefers verified evidence over weak 'not detected' signals", () => {
    expect(topOpportunity([opp("no_chatbot", "not_detected"), opp("no_ssl", "verified", "Website security (SSL) setup")])!.key).toBe("no_ssl");
    expect(topOpportunity([opp("limited_presence", "not_detected")])).toBeNull();
  });
  it("hedges what was merely not detected and includes opt-out + compliance warnings", () => {
    const [email, sms, call] = generateOutreach({ businessName: "Alpha Dental", city: "Brooklyn", subcategory: "Dental clinics", website: "https://alpha.test", opportunities: [opp("no_online_booking", "not_detected")], sender });
    expect(email.body).toMatch(/I may have missed it/);
    expect(email.body).toMatch(/unsubscribe/i);
    expect(email.body).toContain("1 Main St");
    expect(email.warnings.join(" ")).toMatch(/did not detect/i);
    expect(sms.body).toMatch(/STOP/);
    expect(sms.warnings.join(" ")).toMatch(/consent/i);
    expect(call.warnings.join(" ")).toMatch(/do-not-call/i);
    expect(email.basis[0]).toMatch(/not detected/i);
  });
  it("states verified findings plainly and never invents specifics", () => {
    const [email] = generateOutreach({ businessName: "Beta", opportunities: [{ ...opp("no_ssl", "verified", "Website security (SSL) setup"), detail: "x" }], website: "https://beta.test", sender });
    expect(email.body).toMatch(/isn't served over a secure \(HTTPS\) connection/);
    expect(email.body).not.toMatch(/I may have missed it/);
    const [noOpp] = generateOutreach({ businessName: "Gamma", opportunities: [], sender });
    expect(noOpp.basis[0]).toMatch(/generic introduction/);
  });
  it("warns when the sender address is missing", () => {
    const [email] = generateOutreach({ businessName: "Beta", opportunities: [], sender: { name: "Sam", company: "Co" } });
    expect(email.warnings.join(" ")).toMatch(/postal address/i);
  });
});

describe("search advisor & config validation", () => {
  const base = { nicheIds: ["healthcare-and-medical.dental-clinics"], location: { label: "Brooklyn", lat: 40.65, lng: -73.95, placeType: "suburb" }, radius: { value: 10, unit: "km" }, sources: ["osm"], strategy: "balanced" };
  it("accepts a valid config and applies defaults", () => {
    const c = searchConfigSchema.parse(base);
    expect(c.enrichWebsites).toBe(true);
    expect(c.filters.website).toBe("any");
  });
  it("rejects invalid coordinates, empty sources and absurd radii", () => {
    expect(() => searchConfigSchema.parse({ ...base, location: { ...base.location, lat: 120 } })).toThrow();
    expect(() => searchConfigSchema.parse({ ...base, sources: [] })).toThrow();
    expect(() => searchConfigSchema.parse({ ...base, radius: { value: 9999, unit: "km" } })).toThrow();
  });
  it("flags a missing niche, an unconfigured source and a too-large radius", () => {
    const empty = adviseSearch(searchConfigSchema.parse({ ...base, nicheIds: [] }));
    expect(empty.canStart).toBe(false);
    const google = adviseSearch(searchConfigSchema.parse({ ...base, sources: ["osm", "google_places"] }));
    expect(google.advice.some((a) => /not configured/i.test(a.title))).toBe(process.env.GOOGLE_MAPS_API_KEY ? false : true);
    const big = adviseSearch(searchConfigSchema.parse({ ...base, radius: { value: 200, unit: "km" } }));
    expect(big.advice.some((a) => /Radius looks large/.test(a.title))).toBe(true);
  });
  it("explains that rating filters do little on OpenStreetMap-only searches", () => {
    const r = adviseSearch(searchConfigSchema.parse({ ...base, filters: { minRating: 4.5, website: "any", requirePhone: false, requireEmail: false, opportunities: [] } }));
    expect(r.advice.some((a) => /Rating \/ review filters/.test(a.title))).toBe(true);
  });
  it("only shows a result-volume estimate when real history exists", () => {
    const cfg = searchConfigSchema.parse(base);
    expect(adviseSearch(cfg).radius.expectedLeads).toBeUndefined();
    const withHistory = adviseSearch(cfg, [{ nicheIds: ["x"], radiusKm: 5, leads: 25 }, { nicheIds: ["x"], radiusKm: 10, leads: 70 }]);
    expect(withHistory.radius.expectedLeads?.basedOnSearches).toBe(2);
  });
});
