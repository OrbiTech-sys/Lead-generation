import { googlePlacesConnector } from "./google-places";
import { osmConnector } from "./osm-overpass";
import type { Connector, ConnectorInfo } from "./types";

/** Connectors that can actually run discovery. */
export const DISCOVERY_CONNECTORS: Connector[] = [osmConnector, googlePlacesConnector];

export function getConnector(id: string): Connector | undefined {
  return DISCOVERY_CONNECTORS.find((c) => c.info.id === id);
}

const planned = (
  id: string,
  name: string,
  summary: string,
  access: string,
  extra: Partial<ConnectorInfo> = {},
): ConnectorInfo => ({
  id,
  name,
  kind: "discovery",
  status: "planned",
  summary,
  returns: [],
  cost: access,
  requiresKey: true,
  limits: "Not implemented.",
  freshness: "n/a",
  regions: "n/a",
  compliance: "Only an official/licensed access method will be used — no scraping behind logins or of terms-restricted pages.",
  ...extra,
});

/** Sources from the product spec that are NOT implemented. Shown honestly as "planned". */
export const PLANNED_CONNECTORS: ConnectorInfo[] = [
  planned("web_search", "Web search (licensed API)", "Business discovery through a licensed search API (Brave/Bing/SerpAPI-style). No SERP scraping.", "Needs a paid/free-tier search API key.", { envVar: "SEARCH_API_KEY" }),
  planned("foursquare", "Foursquare Places", "Official Places API.", "API key; free tier with limits.", { envVar: "FOURSQUARE_API_KEY" }),
  planned("yelp", "Yelp Fusion", "Official Yelp API.", "API key; limited trial then paid.", { envVar: "YELP_API_KEY" }),
  planned("bbb", "Better Business Bureau", "BBB has no public API; requires a data-licensing agreement.", "Commercial agreement."),
  planned("linkedin", "LinkedIn companies", "Only via LinkedIn's approved partner programmes. Scraping is prohibited.", "Partner approval."),
  planned("facebook", "Facebook Pages", "Meta Graph API (Page Public Content Access needs app review).", "App review + keys."),
  planned("instagram", "Instagram business accounts", "Meta Graph API business discovery.", "App review + keys."),
  planned("directories", "Chambers / associations / trade directories", "Per-source adapters for directories that permit access.", "Varies per directory."),
  planned("registries", "Government business registries", "Per-jurisdiction open-data adapters (e.g. Companies House, SEC, OpenCorporates).", "Mostly free; some need keys."),
];

export const WEBSITE_ENRICHER_INFO: ConnectorInfo = {
  id: "website",
  name: "Official business websites",
  kind: "enrichment",
  status: "live_tested",
  summary: "Visits each discovered business's own public website to extract published contact details and audit digital gaps.",
  returns: ["published emails", "phone numbers", "social links", "contact form", "booking/ordering/chat signals", "HTTPS status", "response time", "broken-link sample"],
  cost: "Free (uses your server's bandwidth)",
  requiresKey: false,
  limits: "Homepage + contact page + up to 8 sampled links per site. Skips sites whose robots.txt disallows access. 10 s timeout, 1.5 MB cap.",
  freshness: "Live at the time of the search.",
  regions: "Worldwide.",
  compliance: "Honours robots.txt, identifies itself via User-Agent, blocks private/internal addresses (SSRF guard). Does not fill forms or log in.",
};
