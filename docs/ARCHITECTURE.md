# OrbiTech Lead Intelligence — Architecture

Product of **The OrbiTech Solution** (theorbitechsolution.com).
A B2B lead discovery, verification, scoring and CRM platform built on legitimate, attributable data.

## 1. Guiding decisions

| Decision | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router, Cache Components, `proxy.ts`), React 19, TypeScript, Tailwind 4 | Already scaffolded; one deployable for UI + API |
| Database | PostgreSQL via Drizzle ORM. **Local default: PGlite** (embedded Postgres, zero setup). **Production: `DATABASE_URL=postgres://…`** (`docker compose up`) | Same SQL dialect and migrations in both; no install needed to try the product |
| Geo queries | Haversine in application code; lat/lng stored as `double precision` | PostGIS is a documented future upgrade, not required at current scale |
| Jobs | DB-backed job state + in-process runner behind a `runSearch()` boundary. BullMQ/Redis worker is the documented production upgrade | No mandatory Redis; progress, cancellation and logs are all persisted, so they survive page reloads |
| Auth | Email + password (scrypt), server-side sessions (hashed token in DB, HttpOnly cookie), org + role model | No third-party dependency, revocable sessions |
| AI | **None required.** Scoring, opportunity detection, verification and outreach drafts are deterministic and explainable. Optional local Ollama hook for outreach polish | Spec: no paid APIs, CPU-only, never invent facts |
| Secrets | Environment variables only, read server-side | Spec: secure key storage |

## 2. Module map

```
app/
  (auth)/login, register
  (app)/ dashboard, find-leads, leads, lists, saved-searches, map, sources,
         verification, analytics, outreach, team, integrations, settings
  api/   auth, geocode, searches, leads, lists, export, sources, outreach, ...
lib/
  db/            schema.ts, index.ts (PGlite|pg), migrate.ts
  auth/          password.ts, session.ts, guard.ts, rate-limit.ts
  taxonomy/      niches.ts  (hierarchical, searchable, custom niches)
  geo/           distance.ts, recommend.ts (radius heuristics)
  connectors/    types.ts, registry.ts, osm-overpass.ts, google-places.ts, (planned stubs)
  enrich/        website-audit.ts, contacts.ts, robots.ts
  verify/        phone.ts, email.ts, website.ts, status.ts
  scoring/       score.ts (configurable weights, full breakdown), opportunities.ts
  dedupe/        match.ts (normalise, fuzzy, confidence), merge.ts (+undo)
  search/        runner.ts (orchestrator), config.ts (zod), advisor.ts, strategies.ts
  export/        csv.ts, xlsx.ts, json.ts
  outreach/      templates.ts (deterministic drafts grounded in lead facts)
tests/           vitest suites + fixtures
```

## 3. Data model (summary)

`users, sessions, organizations, memberships(role)` – tenancy and RBAC.
`searches(config jsonb, status, stats jsonb)`, `search_events` – job state + live log.
`leads` – one row per business per org; contact fields, geo, `status` (pipeline stage), `score`,
`score_breakdown`, `verification_status`, `opportunities jsonb`, `website_audit jsonb`, `tags[]`,
`do_not_contact`, `is_demo`.
`lead_sources` – **provenance**: every source record that contributed to a lead (source id, URL, raw payload, collected-at).
`lead_activities` – notes, calls, emails, status changes, follow-up dates.
`merge_candidates`, `merge_history` – uncertain duplicate pairs; snapshot for merge undo.
`lists, list_items`, `pipeline_stages` (customisable), `saved_niches`.
`suppressions` – do-not-contact by email / phone / domain; enforced at export and outreach.
`audit_logs`, `api_usage` – accountability and provider quota tracking.
`outreach_drafts` – generated drafts (never sent by the platform).

## 4. Source integration strategy

Every connector declares: what it returns, cost, key requirement, regional coverage, freshness, and an
**implementation status**. The UI shows that status verbatim — nothing is presented as operational unless it is.

| Source | Status | Access method | Cost / key |
|---|---|---|---|
| OpenStreetMap (Overpass + Nominatim) | **Live, tested** | Official public APIs, ODbL data, 1 req/s geocoding policy honoured | Free, no key. Coverage varies by region |
| Official business websites | **Live, tested** | Direct fetch of public pages; `robots.txt` honoured; timeouts; rate-limited | Free |
| Google Places API (New) | Implemented, **untested** until a key is configured | Official API, server-side, field-masked to control cost | Needs `GOOGLE_MAPS_API_KEY`; billed per request by Google |
| Foursquare Places | Planned | Official API | Key required |
| Yelp Fusion | Planned | Official API | Key required, limited free tier |
| Google web search | Planned | Licensed search API only (no SERP scraping) | Key required |
| BBB | Planned | No public API; needs a data agreement | Partnership |
| LinkedIn / Facebook / Instagram | Planned | Official partner/Graph APIs only; no scraping | Approval + keys |
| Government registries, chambers, associations | Planned | Per-jurisdiction open-data adapters | Mostly free |

We do **not** scrape search-engine result pages, social platforms behind login, or classified sites (OLX etc.).
Personal-contact discovery is excluded; the platform stores only business contact data plus user-supplied, consented lists.

## 5. Search pipeline

1. **Validate** config (zod) → create `searches` row (queued).
2. **Plan**: for each (niche × source) build a request; radius auto-expansion if volume is below target.
3. **Discover**: connectors run independently; a failing connector logs an event and the rest continue.
4. **Normalise** → `RawLead`.
5. **Deduplicate** against this run and existing leads (auto-merge high confidence, queue uncertain pairs).
6. **Enrich** (optional): website fetch, contact extraction, digital-gap audit.
7. **Verify**: phone (libphonenumber), email (syntax, disposable, MX), website (HTTP/SSL/redirects).
8. **Score** (0–100, configurable weights, full breakdown) and **detect opportunities** (verified / not detected / unknown).
9. **Persist** leads + provenance, update progress counters continuously; honour cancellation between steps.

Progress numbers shown in the UI are the persisted counters — never simulated.

## 6. Scoring (lead quality, *not* sale probability)

Contact completeness 20 · Source reliability 20 · Business relevance 20 · Digital opportunity 20 ·
Data freshness 10 · Activity evidence 10. Weights are configurable per org; each lead stores the
per-component points and the reasons. Missing data lowers the score; nothing is invented to raise it.

## 7. Milestones

| Phase | Scope | State in this repo |
|---|---|---|
| 1 Foundation | DB, auth, orgs, taxonomy, geo, lead model, shell | Built |
| 2 Discovery | OSM + Google Places connectors, source registry, search jobs | Built (OSM live-tested; Google needs key) |
| 3 Intelligence | Website audit, contact extraction, verification, dedupe, scoring, opportunities | Built |
| 4 Lead mgmt | Lead table, filters, notes, pipeline, lists, saved searches, outreach tracker | Built (core), see README for gaps |
| 5 Export/analytics | CSV, XLSX, JSON; analytics from real data | Built (PDF reports not built) |
| 6 AI | Local-model review analysis & classification | Not built (hooks documented) |
| 7 Production | Docker, docs, tests | Docker + docs + tests built; load/security review pending |
