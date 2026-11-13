import "server-only";
import { and, between, eq, gte, inArray, or, sql } from "drizzle-orm";
import { getDb, schema, type Db } from "../db";
import { getConnector as realGetConnector } from "../connectors/registry";
import type { Connector, RawLead } from "../connectors/types";
import { compareRecords, normalizeName, usableDomain, type MatchRecord, type MatchResult } from "../dedupe/match";
import { auditWebsite as realAudit, domainOf, normalizeUrl, type WebsiteAudit } from "../enrich/website-audit";
import { boundingBox, haversineKm, toKm } from "../geo/distance";
import { SOURCE_RELIABILITY } from "../scoring/score";
import { getNiche, resolveNiches, type Niche } from "../taxonomy/niches";
import { checkEmail as realCheckEmail, type EmailResult } from "../verify/email";
import { checkPhone, normalizePhoneKey } from "../verify/phone";
import { emptyStats, searchConfigSchema, type SearchConfig, type SearchStats } from "./config";
import { intelligenceFor, rowToFacts, type LeadRow } from "./facts";
import { STRATEGIES } from "./strategies";

const { searches, searchEvents, leads, leadSources, mergeCandidates, apiUsage, organizations, auditLogs } = schema;

export interface RunnerDeps {
  getConnector: (id: string) => Connector | undefined;
  auditWebsite: (url: string) => Promise<WebsiteAudit>;
  checkEmail: (email: string) => Promise<EmailResult | null>;
}

const realDeps: RunnerDeps = {
  getConnector: realGetConnector,
  auditWebsite: (u) => realAudit(u),
  checkEmail: (e) => realCheckEmail(e),
};

class CancelledError extends Error {}

/** In-process registry so a cancel request can abort in-flight network calls immediately. */
const g = globalThis as unknown as { __searchControllers?: Map<string, AbortController> };
const controllers = (g.__searchControllers ??= new Map());

export function isRunningHere(searchId: string) {
  return controllers.has(searchId);
}

export async function startSearch(orgId: string, userId: string, rawConfig: unknown, opts: { deps?: Partial<RunnerDeps>; await?: boolean } = {}) {
  const config = searchConfigSchema.parse(rawConfig);
  const db = await getDb();
  const niches = resolveNiches(config.nicheIds, config.customNiches);
  if (!niches.length) throw new Error("Select at least one niche.");

  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(searches)
    .where(and(eq(searches.orgId, orgId), gte(searches.createdAt, todayStart)));
  if (org && n >= org.dailySearchQuota) throw new Error(`Daily search quota reached (${org.dailySearchQuota}). Quota resets at midnight server time.`);

  const name = config.name || `${niches.map((x) => x.name).slice(0, 2).join(", ")}${niches.length > 2 ? "…" : ""} · ${config.location.label.split(",")[0]}`;
  const [row] = await db
    .insert(searches)
    .values({ orgId, userId, name, config, status: "queued", stats: emptyStats() })
    .returning();
  await db.insert(auditLogs).values({ orgId, userId, action: "search.start", detail: { searchId: row.id } });

  const job = runSearch(row.id, opts.deps).catch((e) => console.error("[search] unhandled", e));
  if (opts.await) await job;
  return row.id as string;
}

export async function cancelSearch(orgId: string, searchId: string): Promise<boolean> {
  const db = await getDb();
  const res = await db
    .update(searches)
    .set({ cancelRequested: true })
    .where(and(eq(searches.id, searchId), eq(searches.orgId, orgId), inArray(searches.status, ["queued", "running"])))
    .returning({ id: searches.id });
  controllers.get(searchId)?.abort();
  return res.length > 0;
}

/** Jobs that were running when the server stopped cannot continue; mark them so the UI is honest. */
export async function recoverOrphanedSearches() {
  const db = await getDb();
  const live = [...controllers.keys()];
  const stuck = await db.select({ id: searches.id }).from(searches).where(inArray(searches.status, ["queued", "running"]));
  for (const s of stuck.filter((s) => !live.includes(s.id))) {
    await db
      .update(searches)
      .set({ status: "failed", error: "Interrupted by a server restart. Re-run it from Saved Searches.", finishedAt: new Date() })
      .where(eq(searches.id, s.id));
  }
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T, i: number) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i], i);
      }
    }),
  );
}

interface Cluster {
  records: RawLead[];
  rep: MatchRecord;
}

const rank = (r: RawLead) => SOURCE_RELIABILITY[r.source] ?? 0.5;
const first = <T,>(recs: RawLead[], pick: (r: RawLead) => T | undefined | null): T | undefined => {
  for (const r of recs) {
    const v = pick(r);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
};

function toMatch(r: RawLead, country?: string): MatchRecord {
  return { name: r.name, lat: r.lat, lng: r.lng, phoneE164: normalizePhoneKey(r.phone, r.country ?? country), domain: domainOf(r.website), address: r.address, postcode: r.postcode };
}

/** Group records that are the same business. Name similarity alone never merges (see compareRecords). */
export function clusterRecords(records: RawLead[], country?: string) {
  const clusters: Cluster[] = [];
  const grid = new Map<string, Cluster[]>();
  const noCoords: Cluster[] = [];
  const cell = (lat: number, lng: number) => `${Math.floor(lat * 100)}:${Math.floor(lng * 100)}`; // ~1.1 km cells
  const review: { a: Cluster; b: Cluster; result: MatchResult }[] = [];
  let merged = 0;

  const neighbors = (lat: number, lng: number) => {
    const cy = Math.floor(lat * 100);
    const cx = Math.floor(lng * 100);
    const out: Cluster[] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) out.push(...(grid.get(`${cy + dy}:${cx + dx}`) ?? []));
    return out;
  };
  const register = (c: Cluster) => {
    clusters.push(c);
    if (c.rep.lat != null && c.rep.lng != null) {
      const k = cell(c.rep.lat, c.rep.lng);
      grid.set(k, [...(grid.get(k) ?? []), c]);
    } else noCoords.push(c);
  };

  for (const rec of [...records].sort((a, b) => rank(b) - rank(a))) {
    const m = toMatch(rec, country);
    const pool = m.lat != null && m.lng != null ? [...neighbors(m.lat, m.lng), ...noCoords] : clusters;
    let best: { c: Cluster; r: MatchResult } | null = null;
    const maybe: { c: Cluster; r: MatchResult }[] = [];
    for (const c of pool) {
      const r = compareRecords(m, c.rep);
      if (r.decision === "merge" && (!best || r.confidence > best.r.confidence)) best = { c, r };
      else if (r.decision === "review") maybe.push({ c, r });
    }
    if (best) {
      best.c.records.push(rec);
      // enrich representative with newly available match keys
      best.c.rep = { ...best.c.rep, lat: best.c.rep.lat ?? m.lat, lng: best.c.rep.lng ?? m.lng, phoneE164: best.c.rep.phoneE164 ?? m.phoneE164, domain: best.c.rep.domain ?? m.domain };
      merged++;
    } else {
      const c: Cluster = { records: [rec], rep: m };
      register(c);
      for (const x of maybe) review.push({ a: x.c, b: c, result: x.r });
    }
  }
  return { clusters, review, merged };
}

export async function runSearch(searchId: string, depsIn: Partial<RunnerDeps> = {}) {
  const deps: RunnerDeps = { ...realDeps, ...depsIn };
  const db = await getDb();
  const [row] = await db.select().from(searches).where(eq(searches.id, searchId));
  if (!row) return;
  const cfg = searchConfigSchema.parse(row.config);
  const orgId = row.orgId;
  const strategy = STRATEGIES[cfg.strategy];
  const controller = new AbortController();
  controllers.set(searchId, controller);
  const stats: SearchStats = emptyStats();
  const usage = new Map<string, { req: number; err: number }>();
  const day = new Date().toISOString().slice(0, 10);

  const ev = async (level: "info" | "warn" | "error", message: string, source?: string) => {
    await db.insert(searchEvents).values({ searchId, level, source: source ?? null, message });
  };
  const flush = async () => {
    await db.update(searches).set({ stats }).where(eq(searches.id, searchId));
  };
  const checkpoint = async () => {
    if (controller.signal.aborted) throw new CancelledError();
    const [r] = await db.select({ c: searches.cancelRequested }).from(searches).where(eq(searches.id, searchId));
    if (r?.c) {
      controller.abort();
      throw new CancelledError();
    }
  };
  const flushUsage = async () => {
    for (const [provider, u] of usage) {
      await db
        .insert(apiUsage)
        .values({ orgId, provider, day, requests: u.req, errors: u.err })
        .onConflictDoUpdate({ target: [apiUsage.orgId, apiUsage.provider, apiUsage.day], set: { requests: sql`${apiUsage.requests} + ${u.req}`, errors: sql`${apiUsage.errors} + ${u.err}` } });
    }
    usage.clear();
  };

  try {
    await db.update(searches).set({ status: "running", startedAt: new Date() }).where(eq(searches.id, searchId));
    const niches = resolveNiches(cfg.nicheIds, cfg.customNiches);
    let radiusKm = toKm(cfg.radius.value, cfg.radius.unit);
    const center = { lat: cfg.location.lat, lng: cfg.location.lng };
    const country = cfg.location.countryCode?.toUpperCase();

    const connectors: Connector[] = [];
    for (const id of cfg.sources) {
      const c = deps.getConnector(id);
      if (!c) await ev("warn", "Source is not implemented and was skipped.", id);
      else if (!c.isConfigured()) await ev("warn", `Skipped — ${c.setupMessage()}`, id);
      else connectors.push(c);
    }
    if (!connectors.length) throw new Error("None of the selected sources can run. Configure a source or select OpenStreetMap.");
    stats.sourcesTotal = connectors.length;
    await ev("info", `Search started: ${niches.map((n) => n.name).join(", ")} within ${radiusKm.toFixed(1)} km of ${cfg.location.label} (${strategy.label}).`);
    stats.phase = "discovering";
    await flush();

    // ---------- 1. Discovery (sources isolated from each other) ----------
    let all = new Map<string, RawLead>();
    const maxRounds = cfg.autoExpand || strategy.autoExpandDefault ? 3 : 1;
    for (let round = 0; round < maxRounds; round++) {
      stats.radiusKmUsed = radiusKm;
      all = new Map();
      stats.sourcesDone = 0;
      stats.bySource = {};
      await Promise.all(
        connectors.map(async (conn) => {
          const sid = conn.info.id;
          stats.bySource[sid] = { found: 0, errors: 0 };
          for (const niche of niches) {
            try {
              await checkpoint();
              const found = await conn.discover({
                niche, lat: center.lat, lng: center.lng, radiusKm,
                exclude: cfg.excludeKeywords, limit: strategy.maxPerNiche, signal: controller.signal, countryHint: country,
                log: (level, msg) => {
                  if (/busy|retry|429|rate/i.test(msg)) stats.rateLimitWarnings++;
                  void ev(level, msg, sid);
                },
                trackRequest: (ok) => {
                  const u = usage.get(sid) ?? { req: 0, err: 0 };
                  u.req++;
                  if (!ok) { u.err++; stats.failedRequests++; }
                  usage.set(sid, u);
                },
              });
              for (const r of found) all.set(`${r.source}:${r.sourceRecordId}`, r);
              stats.bySource[sid].found += found.length;
              await ev("info", `${niche.name}: ${found.length} businesses found.`, sid);
            } catch (e) {
              if (e instanceof CancelledError || controller.signal.aborted) throw new CancelledError();
              stats.bySource[sid].errors++;
              await ev("error", `${niche.name}: ${(e as Error).message}`, sid);
            }
            stats.discovered = all.size;
            await flush();
          }
          stats.sourcesDone++;
        }),
      );
      await flushUsage();
      const failedEverywhere = Object.values(stats.bySource).every((s) => s.errors > 0 && s.found === 0);
      if (failedEverywhere) throw new Error("Every selected source failed. See the activity log for details.");
      if (all.size < 30 && round < maxRounds - 1 && radiusKm < 100) {
        radiusKm = Math.min(100, Math.round(radiusKm * 1.6 * 10) / 10);
        stats.expansions++;
        await ev("info", `Only ${all.size} results — auto-expanding radius to ${radiusKm} km.`);
        continue;
      }
      break;
    }

    // ---------- 2. Cheap filters (before any enrichment cost) ----------
    stats.phase = "filtering";
    await checkpoint();
    const f = cfg.filters;
    const nicheById = new Map(niches.map((n) => [n.id, n]));
    let records = [...all.values()].filter((r) => {
      if (r.lat != null && r.lng != null && haversineKm(center.lat, center.lng, r.lat, r.lng) > radiusKm * 1.02) return false;
      if (strategy.tagMatchesOnly && r.matchBasis === "keyword") return false;
      if (f.minRating != null && r.rating != null && r.rating < f.minRating) return false; // unrated records are kept, not guessed
      if (f.minReviews != null && r.reviewCount != null && r.reviewCount < f.minReviews) return false;
      if (f.maxReviews != null && r.reviewCount != null && r.reviewCount > f.maxReviews) return false;
      if (f.website === "has" && !r.website) return false;
      if (f.website === "none" && r.website) return false;
      return true;
    });
    stats.filteredOut += all.size - records.length;

    // ---------- 3. Deduplicate (within run, then against existing leads) ----------
    stats.phase = "deduplicating";
    const { clusters, review, merged } = clusterRecords(records, country);
    stats.duplicatesMerged += merged;
    await ev("info", `Deduplication: ${records.length} records → ${clusters.length} unique businesses (${merged} merged across sources).`);

    const bb = boundingBox(center.lat, center.lng, radiusKm * 1.05);
    const phones = clusters.map((c) => c.rep.phoneE164).filter((x): x is string => !!x);
    const domains = clusters.map((c) => usableDomain(c.rep.domain)).filter((x): x is string => !!x);
    const existing: LeadRow[] = await db
      .select()
      .from(leads)
      .where(
        and(
          eq(leads.orgId, orgId),
          or(
            and(between(leads.lat, bb.south, bb.north), between(leads.lng, bb.west, bb.east)),
            phones.length ? inArray(leads.phoneE164, phones) : undefined,
            domains.length ? inArray(leads.websiteDomain, domains) : undefined,
          ),
        ),
      );
    const existingMatch = (l: LeadRow): MatchRecord => ({ name: l.name, lat: l.lat, lng: l.lng, phoneE164: l.phoneE164, domain: l.websiteDomain, address: l.address });

    const weights = await orgWeights(db, orgId);
    const fresh: Cluster[] = [];
    const pendingReview: { clusterIdx: Cluster; existingId: string; result: MatchResult }[] = [];
    for (const c of clusters) {
      let best: { l: LeadRow; r: MatchResult } | null = null;
      for (const l of existing) {
        const r = compareRecords(c.rep, existingMatch(l));
        if (r.decision === "merge" && (!best || r.confidence > best.r.confidence)) best = { l, r };
        else if (r.decision === "review") pendingReview.push({ clusterIdx: c, existingId: l.id, result: r });
      }
      if (best) {
        await attachToExisting(db, best.l, c.records, searchId, weights);
        stats.updatedExisting++;
        stats.duplicatesMerged++;
        // drop review candidates created for this cluster; it merged
        for (let i = pendingReview.length - 1; i >= 0; i--) if (pendingReview[i].clusterIdx === c) pendingReview.splice(i, 1);
      } else fresh.push(c);
    }
    if (existing.length) await ev("info", `${stats.updatedExisting} businesses already existed in your leads — sources added instead of creating duplicates.`);
    await flush();

    // ---------- 4. Enrich → verify → score → persist ----------
    stats.phase = "enriching";
    const clusterLead = new Map<Cluster, string>();
    await mapLimit(fresh, 4, async (c) => {
      await checkpoint();
      const recs = [...c.records].sort((a, b) => rank(b) - rank(a));
      const niche = nicheById.get(recs[0].nicheId ?? "") ?? getNiche(recs[0].nicheId ?? "") ?? niches[0];
      const draft = await buildDraft(recs, niche, cfg, deps, stats, ev);
      const facts = draftFacts(draft, recs, niche);
      const intel = intelligenceFor(facts, weights);

      // post-enrichment filters
      const channels = [draft.phone, draft.email, draft.website, draft.facebook, draft.instagram, draft.linkedin].filter(Boolean).length;
      const hasRoute = !!(draft.phone || draft.email || draft.website);
      let keep = true;
      if (strategy.requireContactRoute && !hasRoute) keep = false;
      if (f.requirePhone && !draft.phone) keep = false;
      if (f.requireEmail && !draft.email) keep = false;
      if (f.website === "has" && !draft.website) keep = false;
      if (f.website === "none" && draft.website) keep = false;
      if (f.minChannels != null && channels < f.minChannels) keep = false;
      if (f.opportunities.length && !intel.opportunities.some((o) => f.opportunities.includes(o.key as never))) keep = false;
      if (intel.score < Math.max(strategy.minScore, f.minScore ?? 0)) keep = false;
      if (strategy.requireContactRoute && intel.classification === "needs_verification") keep = false; // closed / unverifiable
      if (!keep) {
        stats.filteredOut++;
        return;
      }

      const [inserted] = await db
        .insert(leads)
        .values({
          orgId, searchId,
          name: recs[0].name,
          nameNorm: normalizeName(recs[0].name),
          nicheId: niche.id,
          industry: niche.category,
          subcategory: niche.name,
          ...draft,
          matchBasis: recs[0].matchBasis,
          sourcePrimary: recs[0].source,
          sourceCount: new Set(recs.map((r) => r.source)).size,
          ...intel,
          lastVerifiedAt: draft.websiteAudit || draft.phoneStatus !== "unverified" ? new Date() : null,
        })
        .returning({ id: leads.id });
      await db.insert(leadSources).values(
        recs.map((r) => ({ leadId: inserted.id, source: r.source, sourceRecordId: r.sourceRecordId, sourceUrl: r.sourceUrl ?? null, raw: r.raw ?? null, searchId })),
      ).onConflictDoNothing();
      const wa = draft.websiteAudit as WebsiteAudit | null | undefined;
      if (wa?.reachable === "detected") {
        const siteUrl = wa.finalUrl ?? wa.url;
        await db.insert(leadSources).values({ leadId: inserted.id, source: "website", sourceRecordId: siteUrl, sourceUrl: siteUrl, raw: { title: wa.title }, searchId }).onConflictDoNothing();
      }
      clusterLead.set(c, inserted.id);
      stats.newLeads++;
      if (intel.verificationStatus !== "unverified") stats.verified++;
      await flush();
    });

    // ---------- 5. Uncertain duplicates → manual review queue ----------
    const pairs: { a: string; b: string; result: MatchResult }[] = [];
    for (const r of review) {
      const a = clusterLead.get(r.a);
      const b = clusterLead.get(r.b);
      if (a && b) pairs.push({ a, b, result: r.result });
    }
    for (const p of pendingReview) {
      const b = clusterLead.get(p.clusterIdx);
      if (b) pairs.push({ a: p.existingId, b, result: p.result });
    }
    if (pairs.length) {
      await db.insert(mergeCandidates).values(pairs.map((p) => ({ orgId, leadAId: p.a, leadBId: p.b, confidence: p.result.confidence, reasons: p.result.reasons })));
      stats.uncertainDuplicates = pairs.length;
      await ev("info", `${pairs.length} possible duplicate pair(s) queued for manual review in the Verification Center.`);
    }

    stats.phase = "completed";
    await flushUsage();
    await db.update(searches).set({ status: "completed", finishedAt: new Date(), stats }).where(eq(searches.id, searchId));
    await ev("info", `Done: ${stats.newLeads} new leads, ${stats.updatedExisting} existing updated, ${stats.filteredOut} filtered out, ${stats.failedRequests} failed requests.`);
  } catch (e) {
    await flushUsage().catch(() => {});
    if (e instanceof CancelledError || controller.signal.aborted) {
      stats.phase = "cancelled";
      await db.update(searches).set({ status: "cancelled", finishedAt: new Date(), stats }).where(eq(searches.id, searchId));
      await ev("warn", "Search cancelled. Leads saved before cancellation were kept.");
    } else {
      stats.phase = "failed";
      await db.update(searches).set({ status: "failed", error: (e as Error).message, finishedAt: new Date(), stats }).where(eq(searches.id, searchId));
      await ev("error", (e as Error).message);
    }
  } finally {
    controllers.delete(searchId);
  }
}

async function orgWeights(db: Db, orgId: string) {
  const [o] = await db.select({ w: organizations.scoringWeights }).from(organizations).where(eq(organizations.id, orgId));
  return o?.w ?? null;
}

type Draft = Omit<typeof leads.$inferInsert, "orgId" | "name" | "nameNorm" | "sourcePrimary">;

async function buildDraft(
  recs: RawLead[],
  niche: Niche,
  cfg: SearchConfig,
  deps: RunnerDeps,
  stats: SearchStats,
  ev: (l: "info" | "warn" | "error", m: string, s?: string) => Promise<void>,
): Promise<Draft> {
  const country = (first(recs, (r) => r.country) ?? cfg.location.countryCode)?.toUpperCase().slice(0, 2);
  let phone = first(recs, (r) => r.phone);
  let email = first(recs, (r) => r.email);
  let emailSourceUrl: string | undefined = email ? first(recs, (r) => r.sourceUrl) : undefined;
  const website = first(recs, (r) => (r.website ? normalizeUrl(r.website) ?? undefined : undefined));
  let facebook = first(recs, (r) => r.facebook);
  let instagram = first(recs, (r) => r.instagram);
  let linkedin = first(recs, (r) => r.linkedin);
  let audit: WebsiteAudit | null = null;

  if (website && cfg.enrichWebsites) {
    try {
      audit = await deps.auditWebsite(website);
      stats.enriched++;
      if (audit.contacts.emails.length && !email) {
        const wd = domainOf(website);
        const pick = audit.contacts.emails.find((e) => wd && e.email.endsWith("@" + wd)) ?? audit.contacts.emails[0];
        email = pick.email;
        emailSourceUrl = pick.url;
      }
      if (!phone && audit.contacts.phones[0]) phone = audit.contacts.phones[0];
      facebook ??= audit.contacts.social.facebook;
      instagram ??= audit.contacts.social.instagram;
      linkedin ??= audit.contacts.social.linkedin;
    } catch (e) {
      await ev("warn", `Website check failed for ${website}: ${(e as Error).message}`, "website");
    }
  }

  const ph = checkPhone(phone, country);
  const em = email ? await deps.checkEmail(email).catch(() => null) : null;
  const ts = first(recs, (r) => r.dataTimestamp);
  const websiteStatus = !website ? "none" : !audit ? "unchecked" : audit.reachable === "detected" ? "reachable" : audit.reachable === "verified_absent" ? "unreachable" : "unknown";
  return {
    country: country ?? null,
    state: first(recs, (r) => r.state) ?? null,
    city: first(recs, (r) => r.city) ?? null,
    address: first(recs, (r) => r.address) ?? null,
    postcode: first(recs, (r) => r.postcode) ?? null,
    lat: first(recs, (r) => r.lat) ?? null,
    lng: first(recs, (r) => r.lng) ?? null,
    phone: ph?.international ?? phone ?? null,
    phoneE164: ph?.e164 && ph.status !== "invalid" ? ph.e164 : null,
    phoneType: ph?.type ?? null,
    phoneStatus: ph?.status ?? "unverified",
    email: email ? email.trim().toLowerCase() : null,
    emailStatus: em?.status ?? "unverified",
    emailSourceUrl: email ? emailSourceUrl ?? null : null,
    website: website ?? null,
    websiteDomain: domainOf(website),
    websiteStatus,
    mapsUrl: first(recs, (r) => r.mapsUrl) ?? null,
    rating: first(recs, (r) => r.rating) ?? null,
    reviewCount: first(recs, (r) => r.reviewCount) ?? null,
    facebook: facebook ?? null,
    instagram: instagram ?? null,
    linkedin: linkedin ?? null,
    description: first(recs, (r) => r.description) ?? audit?.description ?? null,
    openingHours: first(recs, (r) => r.openingHours) ?? null,
    businessStatus: first(recs, (r) => r.businessStatus) ?? null,
    websiteAudit: audit,
    sourceDataAt: ts ? new Date(ts) : null,
    isDemo: false,
  };
}

function draftFacts(d: Draft, recs: RawLead[], niche: Niche) {
  return rowToFacts(
    {
      name: recs[0].name, nicheId: niche.id, matchBasis: recs[0].matchBasis,
      address: d.address ?? null, city: d.city ?? null, phone: d.phone ?? null, phoneStatus: d.phoneStatus ?? "unverified",
      email: d.email ?? null, emailStatus: d.emailStatus ?? "unverified", website: d.website ?? null,
      websiteAudit: (d.websiteAudit ?? null) as never, facebook: d.facebook ?? null, instagram: d.instagram ?? null, linkedin: d.linkedin ?? null,
      contactPerson: null, openingHours: d.openingHours ?? null, businessStatus: d.businessStatus ?? null,
      rating: d.rating ?? null, reviewCount: d.reviewCount ?? null, sourceDataAt: d.sourceDataAt ?? null, lastSeenAt: new Date(),
      // same rule as the insert below, so a later re-score gives the same freshness
      lastVerifiedAt: d.websiteAudit || (d.phoneStatus && d.phoneStatus !== "unverified") ? new Date() : null,
    },
    [...new Set([...recs.map((r) => r.source), ...(d.websiteAudit && (d.websiteAudit as WebsiteAudit).reachable === "detected" ? ["website"] : [])])],
  );
}

/** A new search found a business we already hold: keep provenance, fill gaps, never overwrite CRM data. */
async function attachToExisting(db: Db, lead: LeadRow, recs: RawLead[], searchId: string, weights: unknown) {
  await db
    .insert(leadSources)
    .values(recs.map((r) => ({ leadId: lead.id, source: r.source, sourceRecordId: r.sourceRecordId, sourceUrl: r.sourceUrl ?? null, raw: r.raw ?? null, searchId })))
    .onConflictDoNothing();
  const srcs = await db.select({ s: leadSources.source }).from(leadSources).where(eq(leadSources.leadId, lead.id));
  const distinct = [...new Set(srcs.map((x) => x.s))];
  const ordered = [...recs].sort((a, b) => rank(b) - rank(a));
  const fill = <K extends keyof LeadRow>(k: K, v: unknown) => (lead[k] == null || lead[k] === "" ? v ?? null : lead[k]);
  const patch = {
    address: fill("address", first(ordered, (r) => r.address)) as string | null,
    phone: fill("phone", first(ordered, (r) => r.phone)) as string | null,
    email: fill("email", first(ordered, (r) => r.email)) as string | null,
    website: fill("website", first(ordered, (r) => r.website)) as string | null,
    rating: fill("rating", first(ordered, (r) => r.rating)) as number | null,
    reviewCount: fill("reviewCount", first(ordered, (r) => r.reviewCount)) as number | null,
    mapsUrl: fill("mapsUrl", first(ordered, (r) => r.mapsUrl)) as string | null,
    facebook: fill("facebook", first(ordered, (r) => r.facebook)) as string | null,
    instagram: fill("instagram", first(ordered, (r) => r.instagram)) as string | null,
    openingHours: fill("openingHours", first(ordered, (r) => r.openingHours)) as string | null,
  };
  const merged = { ...lead, ...patch, sourceCount: distinct.length };
  if (!lead.phoneE164 && patch.phone) {
    const ph = checkPhone(patch.phone, lead.country ?? undefined);
    Object.assign(merged, { phoneE164: ph?.e164 ?? null, phoneStatus: ph?.status ?? "unverified", phoneType: ph?.type ?? null });
  }
  const intel = intelligenceFor(rowToFacts(merged as LeadRow, distinct), weights as never);
  await db
    .update(leads)
    .set({ ...patch, phoneE164: merged.phoneE164, phoneStatus: merged.phoneStatus, phoneType: merged.phoneType, sourceCount: distinct.length, ...intel, lastSeenAt: new Date(), updatedAt: new Date() })
    .where(eq(leads.id, lead.id));
}

export { rowToFacts };
