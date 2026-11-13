# OrbiTech Lead Intelligence

B2B lead discovery, verification, scoring and mini-CRM — a product of **The OrbiTech Solution** ([theorbitechsolution.com](https://theorbitechsolution.com)).

It finds real businesses from legitimate, attributable sources, checks their public contact details, flags digital gaps a technology vendor could help with, scores lead quality with a fully explainable breakdown, and lets you work the leads through a pipeline. **It never invents data**: blank means "not found", and every finding states how certain it is.

> Architecture, schema and source strategy: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · Integration setup & costs: [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) · Testing: [docs/TESTING.md](docs/TESTING.md)

## Quick start (no accounts, keys or services needed)

```bash
npm install
npm run dev          # http://localhost:3000
```

1. Open `/register` and create a workspace. (An embedded Postgres — PGlite — is created in `./.data/pglite` and migrated automatically.)
2. **Find Leads** → pick a niche → search a place → keep **OpenStreetMap** selected → Start.
3. Watch the real progress on the search page, then open **All Leads**.

Other commands: `npm test` (75 tests) · `npm run typecheck` · `npm run build && npm start` · `npm run db:generate` (after editing `lib/db/schema.ts`).

## What is implemented

| Area | Status |
|---|---|
| Auth: email/password (scrypt), DB-backed revocable sessions, login throttling, organisations, roles (owner/admin/member/viewer), user-level data isolation | ✅ tested |
| Niche taxonomy: 17 categories, 190+ niches, search, select-all, custom niches, exclusions, saved/suggested/recent combinations | ✅ tested |
| Location: place search (Nominatim), coordinates, map click, km/mi, presets + custom radius, radius recommendations (heuristic; volume estimates only from your own history), auto-expand | ✅ tested |
| **OpenStreetMap discovery** (Overpass) | ✅ **live-tested** against the real service |
| **Website enrichment/audit** (published emails, social links, HTTPS validity, speed, booking/chat/CRM signals, broken links; robots.txt honoured; SSRF-guarded) | ✅ **live-tested** on real sites |
| Google Places discovery | ⚠️ implemented, **untested** (needs your API key) |
| Search jobs: background run, persisted progress/log, cancel, re-run, compare, per-source failure isolation, retry/backoff, quota + usage tracking | ✅ tested |
| Verification: phone (libphonenumber, E.164), email (syntax, disposable, MX), website (HTTP/SSL/redirects), verified/partial/unverified | ✅ tested |
| Deduplication: cross-source + against existing leads, auto-merge only on high confidence, manual review queue, merge history + undo | ✅ tested |
| Opportunity detection with evidence levels (verified / detected / not detected / needs review) | ✅ tested |
| Scoring 0–100 with 6 configurable components and full reasons; classifications | ✅ tested |
| Leads table: search, 13 filters, sorting, pagination, bulk actions, drawer with notes/calls/follow-ups, tags, assignment, custom pipeline stages, lists | ✅ |
| Export: CSV, Excel-friendly CSV, XLSX, JSON, column selection, filtered/selected/high-priority; excludes do-not-contact & suppressed | ✅ tested |
| Verification Center, Analytics, Outreach tracker, Map explorer, Team, Settings (weights, stages, suppression list), Data Sources | ✅ |
| Outreach assistant: email / SMS / call-opener drafts grounded in recorded findings, with compliance warnings; **never sends anything** | ✅ tested |
| Docker (`Dockerfile`, `docker-compose.yml` + Postgres) | ⚠️ written, **not built/run** (Docker was not running here) |
| Real PostgreSQL server | ⚠️ `pg` driver path verified over the wire protocol against a PGlite-backed server; not against a real Postgres engine |

## Not built yet (be aware before relying on it)

- **Sources:** Google web search, BBB, LinkedIn, Facebook, Instagram, Yelp, Foursquare, government registries, chamber/association directories. They appear as *planned* on the Data Sources page. Most require paid/approved API access; scraping them is intentionally not done.
- **AI features** (local-model review analysis, classification, opportunity wording). Everything today is rule-based and explainable. No model, no external AI API is used or required.
- Review-complaint analysis, PDF reports, scheduled/recurring searches, new-lead notifications, email invitations (admins create members with a one-time password), billing, admin super-dashboard, drawing a custom search polygon, underserved-area detection, PostGIS, Redis/BullMQ worker (jobs run in the web process; a restart marks running jobs "interrupted" and you re-run them), automated data-retention windows, SMTP-level email probing (deliberately omitted), phone line-type/active checks (needs a paid provider).
- Mobile-usability and performance checks are lightweight (viewport tag, response time). Playwright/Lighthouse audits are not integrated; mobile findings are marked *needs review*.

## Costs & limits (read before scaling)

- **OpenStreetMap**: free, no key. The public Overpass servers are shared and **frequently slow or overloaded** (we saw 30–100 s responses and outright timeouts during testing); the connector fails over between mirrors and reports honest errors. They also reject scraper-looking User-Agents. For real volume, self-host Overpass. Data is © OpenStreetMap contributors (ODbL): attribute it, and review share-alike obligations for derived databases. Public Nominatim allows 1 request/second (enforced).
- **Google Places API**: billed per request by Google. This app requests phone, website and rating fields, which fall in a higher-priced SKU. Check your Cloud billing, set a budget alert, and review Google's terms on storing results before keeping Places data long-term.
- **Websites**: fetched from your server's network; each site costs up to ~11 requests (homepage, contact page, 8 sampled links, robots.txt).
- Data quality varies by region. OpenStreetMap often lacks phones/websites/emails; those fields stay blank rather than being guessed.

## Compliance

The platform stores business contact data with provenance and supports do-not-contact flags and suppression lists (email, phone, domain) enforced at export and outreach-draft time. A publicly visible contact does **not** by itself permit every kind of marketing; GDPR/PECR, CCPA/CPRA, CAN-SPAM, CASL and TCPA depend on region and channel. Draft warnings are prompts, not legal advice. Do not use the platform to harvest private individuals' details.

## Deployment

**Docker (recommended for production)**

```bash
echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)" > .env
# optional: GOOGLE_MAPS_API_KEY=... , OVERPASS_ENDPOINTS=...
docker compose up --build -d
```

The app runs migrations on first connection. Put it behind HTTPS (cookies are `Secure` in production). **Run one app instance**: job state is persisted, but cancellation signals and rate limiting are in-process; multi-instance needs the Redis/BullMQ upgrade.

**Without Docker:** set `DATABASE_URL`, then `npm ci && npm run build && npm start`. Back up the database; with embedded PGlite back up `./.data/pglite`.

## Project layout

```
app/(app)/…          signed-in pages (thin wrappers) · app/api/…  route handlers
components/          UI kit, shell, wizard, lead drawer, views
lib/db               Drizzle schema + driver switch (PGlite ⇄ pg) · drizzle/ SQL migrations
lib/connectors       osm-overpass, google-places, registry (+ planned sources)
lib/enrich           safe fetch (SSRF guard), robots.txt, website audit
lib/verify           phone, email  ·  lib/scoring  scoring + opportunities
lib/dedupe           matching  ·  lib/search  config, strategies, advisor, runner
lib/services         leads query, merge/undo, re-verify  ·  lib/export  CSV/XLSX/JSON
lib/outreach         deterministic draft templates  ·  tests/  vitest suites
```

Next.js 16 note: this repo uses Cache Components and `proxy.ts`; see `AGENTS.md`.
