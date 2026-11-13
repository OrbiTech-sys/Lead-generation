# Testing

```bash
npm test            # vitest run — 75 tests, ~10 s, no network, no services
npm run typecheck
```

Test data is synthetic and lives only in `tests/`; it is never inserted into a real workspace. Integration tests run against an **in-memory PGlite** database with the real migrations (`PGLITE_DIR=memory`, set in `vitest.config.mts`).

| File | Covers |
|---|---|
| `tests/core.test.ts` | Taxonomy (17 categories, uniqueness, search, custom niches, suggested combos), haversine/unit conversion/bounding box, radius recommendations (no volume estimate without history), phone normalisation (E.164), email syntax/disposable/DNS-outcome mapping |
| `tests/intelligence.test.ts` | Dedupe (no merge on name alone, branches stay distinct, uncertain → review), opportunities & evidence levels, scoring (weights, breakdown totals, classification), website HTML analysis, robots.txt parsing, SSRF guard, OSM/Google parsers and Overpass query building/escaping, regressions found in live testing |
| `tests/integration.test.ts` | Register/login/sessions/roles, tenant isolation, full search pipeline with mock connectors (merge across sources, filters, enrichment, provenance, re-run idempotence), per-source failure isolation, honest failure when all sources fail/unconfigured, **cancellation**, manual-review queue |
| `tests/features.test.ts` | Lead filters/sort/pagination/isolation, CSV/JSON/**XLSX** export (formula-injection guard, suppression, column selection, phones as text), merge + **undo**, outreach drafts (hedging, opt-out, warnings), advisor & config validation |

## Live checks performed (manual, against real services)

- OpenStreetMap search through the running app: 16 real dental clinics near Brooklyn → 15 saved, 3 websites audited.
- Website audit on real sites: normal site, site with social links, non-existent domain (→ *verified unreachable*), expired certificate (→ *verified HTTPS problem*), private address (→ blocked).
- Live MX lookups: valid domain, non-existent domain, disposable domain.
- Production build (`next build`) succeeds.
- `pg` driver path over the Postgres wire protocol (against a PGlite-backed server): migrations, register/login, a search run, filtered list, CSV and XLSX export.

Live checks found and fixed real bugs that fixtures missed: email extraction gluing adjacent text, "outdated site" false positives from stray `<center>`/`<font>` text, and non-resolving domains mis-reported as "blocked". Each now has a regression test.

## Not tested

Google Places against the real API, the Docker image, a real PostgreSQL server, browser E2E automation, load/performance, and a security review beyond the guards described in the README.
