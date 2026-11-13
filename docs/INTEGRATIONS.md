# Integrations

Every connector declares what it returns, what it costs, whether it needs a key, its limits, freshness, coverage and compliance notes — shown live on the **Data Sources** page. A source is marked *live* only after it has been implemented **and** tested against the real service.

| Source | Status | Key | Cost |
|---|---|---|---|
| OpenStreetMap (Overpass + Nominatim) | Live, tested | none | Free (fair-use; ODbL attribution) |
| Official business websites | Live, tested | none | Free (your bandwidth) |
| Google Places API (New) | Implemented, untested | `GOOGLE_MAPS_API_KEY` | Paid per request by Google |
| Web search, Foursquare, Yelp, BBB, LinkedIn, Facebook, Instagram, registries, directories | Planned | various | various |

## OpenStreetMap

No setup. Notes learned from live testing:

- Public Overpass servers are shared and often slow/overloaded. The connector waits for a single attempt (abandoned requests keep consuming your server-side slot), fails over between mirrors with exponential backoff, and reports an honest error if none answer.
- They refuse scraper-looking User-Agents. Network identity for OSM services is `API_USER_AGENT` (default `OrbiTechLeadIntelligence/0.1 (https://theorbitechsolution.com)`); website crawling uses the separate, transparent `CRAWLER_USER_AGENT`.
- **Only use global mirrors.** `overpass.osm.ch` is Switzerland-only and silently returns zero results elsewhere. Override with `OVERPASS_ENDPOINTS` (comma-separated) or self-host: <https://wiki.openstreetmap.org/wiki/Overpass_API#Installation>.
- Niches without an official OSM tag (e.g. "Marketing agencies") are matched by business-name keyword, which is lower precision; the UI marks these and *High Precision* drops them.
- OSM has no ratings/reviews. Rating filters keep unrated leads rather than guessing.

## Google Places API (New)

1. Create a Google Cloud project, enable **Places API (New)**, create an API key, restrict it to that API (and to your server's IP).
2. Set a billing **budget alert** — requests are billed per call (this app asks for phone, website and rating, a higher-priced field tier). Text Search returns at most 60 results per query (3 pages) and the radius is capped at 50 km.
3. Set `GOOGLE_MAPS_API_KEY` in `.env.local` / your host and restart.
4. Review the Google Maps Platform terms about storing and caching results before keeping data long-term.

Status stays **implemented, untested** until someone runs it with a real key; the parsing logic is unit-tested against the documented response shape only.

## Adding a connector

Implement `Connector` from `lib/connectors/types.ts` (`info`, `isConfigured`, `setupMessage`, `discover`) returning `RawLead[]` with a stable `sourceRecordId` and `sourceUrl`, then add it to `DISCOVERY_CONNECTORS` in `lib/connectors/registry.ts`. Use official/licensed APIs only. Add a reliability score in `SOURCE_RELIABILITY` (`lib/scoring/score.ts`). Mark it `implemented_untested` until it has run against the real service.

## Not integrated (by design)

Search-engine result scraping, LinkedIn/Facebook/Instagram scraping, classified-ad sites (OLX etc.) and private-individual phone harvesting are out of scope and will not be added.
