import { describe, expect, it } from "vitest";
import { compareRecords, nameSimilarity, normalizeAddress, normalizeName, usableDomain } from "@/lib/dedupe/match";
import { detectOpportunities } from "@/lib/scoring/opportunities";
import { normalizeWeights, scoreLead, verificationStatus } from "@/lib/scoring/score";
import type { LeadFacts } from "@/lib/scoring/types";
import { analyzeHtml, domainOf, normalizeUrl, type WebsiteAudit } from "@/lib/enrich/website-audit";
import { isAllowedByRules, parseRobots } from "@/lib/enrich/robots";
import { isPrivateIp, assertPublicUrl, BlockedUrlError, DnsNotFoundError } from "@/lib/enrich/http";
import { buildOverpassQuery, parseOsmElement } from "@/lib/connectors/osm-overpass";
import { parseGooglePlace } from "@/lib/connectors/google-places";
import { getNiche, customNiche } from "@/lib/taxonomy/niches";

const dental = getNiche("healthcare-and-medical.dental-clinics")!;

describe("dedupe", () => {
  it("normalises names and addresses", () => {
    expect(normalizeName("Joe's Pizza, LLC")).toBe("joe s pizza");
    expect(normalizeName("Café  Müller & Co.")).toBe("cafe muller and");
    expect(normalizeAddress("123 North Main Street, Suite 4")).toBe("123 n main st ste 4");
  });
  it("name similarity is high for variants, low for different businesses", () => {
    expect(nameSimilarity("Bed-Sty Dental Arts", "Bed Sty Dental Arts LLC")).toBeGreaterThan(0.9);
    expect(nameSimilarity("Smith Dental", "Jones Plumbing")).toBeLessThan(0.4);
  });
  const base = { name: "Tribeca Dental Associates", lat: 40.6878, lng: -73.9578, phoneE164: "+17186230893", domain: "tribecadental.com" };
  it("merges same business with phone + proximity", () => {
    const r = compareRecords(base, { ...base, name: "Tribeca Dental Associates PC", lat: 40.68785, lng: -73.95783 });
    expect(r.decision).toBe("merge");
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
  });
  it("NEVER merges on name similarity alone", () => {
    const r = compareRecords({ name: "Main Street Dental" }, { name: "Main Street Dental" });
    expect(r.decision).not.toBe("merge");
  });
  it("keeps branches of a chain distinct (same name/domain/phone, far apart)", () => {
    const r = compareRecords(base, { ...base, lat: 40.75, lng: -73.99, phoneE164: "+12125550000" });
    expect(r.decision).toBe("distinct");
  });
  it("sends uncertain pairs to manual review", () => {
    const r = compareRecords(
      { name: "Bright Smile Dental", lat: 40.6, lng: -73.9 },
      { name: "Bright Smile Dentistry", lat: 40.6004, lng: -73.9, },
    );
    expect(["review", "merge"]).toContain(r.decision);
    const noCoords = compareRecords({ name: "Bright Smile Dental", domain: "bsd.com" }, { name: "Bright Smiles Dental", domain: "bsd.com" });
    expect(noCoords.decision).toBe("review");
  });
  it("ignores platform domains as match signals", () => {
    expect(usableDomain("facebook.com")).toBeNull();
    expect(usableDomain("www.acme.com")).toBe("acme.com");
  });
});

const audit = (over: Partial<WebsiteAudit> = {}, signals: Partial<WebsiteAudit["signals"]> = {}): WebsiteAudit => ({
  url: "https://acme.com", checkedAt: new Date().toISOString(), reachable: "detected", https: "detected", robotsAllowed: true,
  signals: { viewport: "detected", contactForm: "detected", booking: "detected", onlineOrdering: "detected", chat: "detected", crmOrMarketing: "detected", structuredData: "detected", legacyMarkup: "not_detected", ...signals },
  brokenLinks: { checked: 0, broken: [] }, contacts: { emails: [], phones: [], social: {} }, notes: [], ...over,
});

describe("opportunities", () => {
  const f: LeadFacts = { name: "A", sources: ["osm"], nicheBook: true, phone: "+1", address: "x", openingHours: "Mo-Fr" };
  it("no website is 'not_detected', never claimed as verified", () => {
    const o = detectOpportunities(f).find((x) => x.key === "no_website")!;
    expect(o.certainty).toBe("not_detected");
    expect(o.detail).toMatch(/confirm manually/i);
  });
  it("unreachable site / no SSL / slow are verified; missing booking is only not_detected", () => {
    const o = detectOpportunities({
      ...f, website: "https://acme.com",
      websiteAudit: audit({ https: "verified_absent", responseMs: 4200 }, { booking: "not_detected" }),
    });
    const by = Object.fromEntries(o.map((x) => [x.key, x.certainty]));
    expect(by.no_ssl).toBe("verified");
    expect(by.slow_site).toBe("verified");
    expect(by.no_online_booking).toBe("not_detected");
    const dead = detectOpportunities({ ...f, website: "https://x.com", websiteAudit: audit({ reachable: "verified_absent", error: "DNS" }) });
    expect(dead.find((x) => x.key === "website_unreachable")!.certainty).toBe("verified");
  });
  it("mobile usability is 'needs_review' not a fact", () => {
    const o = detectOpportunities({ ...f, website: "https://acme.com", websiteAudit: audit({}, { viewport: "not_detected" }) });
    expect(o.find((x) => x.key === "mobile_unfriendly")!.certainty).toBe("needs_review");
  });
  it("does not report booking gaps for niches where booking is not relevant", () => {
    const o = detectOpportunities({ ...f, nicheBook: false, website: "https://acme.com", websiteAudit: audit({}, { booking: "not_detected" }) });
    expect(o.find((x) => x.key === "no_online_booking")).toBeUndefined();
  });
});

describe("scoring", () => {
  const rich: LeadFacts = {
    name: "A", sources: ["google_places", "osm"], matchBasis: "api", phone: "+1", phoneStatus: "valid_format",
    email: "a@a.com", emailStatus: "domain_verified", website: "https://a.com", websiteAudit: audit(), address: "1 Main",
    openingHours: "x", businessStatus: "OPERATIONAL", reviewCount: 50, dataTimestamp: new Date(),
  };
  it("weights are normalised to 100 and are configurable", () => {
    const w = normalizeWeights({ contact: 50, source: 50, relevance: 0, digital: 0, freshness: 0, activity: 0 });
    expect(Object.values(w).reduce((a, b) => a + b, 0)).toBeCloseTo(100);
    expect(normalizeWeights({ contact: -5, source: 0, relevance: 0, digital: 0, freshness: 0, activity: 0 }).contact).toBe(20);
  });
  it("explains every point and totals match the breakdown", () => {
    const s = scoreLead(rich);
    expect(s.components).toHaveLength(6);
    expect(Math.round(s.components.reduce((a, c) => a + c.points, 0))).toBe(s.total);
    expect(s.components.every((c) => c.reasons.length > 0)).toBe(true);
    expect(s.note).toMatch(/not a probability/i);
  });
  it("complete multi-source leads outscore sparse ones; missing data is never invented", () => {
    const sparse = scoreLead({ name: "B", sources: ["osm"], matchBasis: "keyword", phone: "+1", phoneStatus: "valid_format" });
    expect(scoreLead(rich).total).toBeGreaterThan(sparse.total);
    expect(sparse.components.find((c) => c.key === "contact")!.points).toBeLessThan(10);
  });
  it("classification: no contact route or closed => needs verification", () => {
    expect(scoreLead({ name: "C", sources: ["osm"] }).classification).toBe("needs_verification");
    expect(scoreLead({ ...rich, businessStatus: "CLOSED_PERMANENTLY" }).classification).toBe("needs_verification");
    expect(["high_priority", "good_potential"]).toContain(scoreLead(rich).classification);
  });
  it("verification status counts independent checks", () => {
    expect(verificationStatus(rich)).toBe("verified");
    expect(verificationStatus({ name: "x", sources: ["osm"] })).toBe("unverified");
    expect(verificationStatus({ name: "x", sources: ["osm"], phoneStatus: "valid_format" })).toBe("partial");
  });
});

const HTML = `<!doctype html><html><head><title>Acme Dental</title>
<meta name="viewport" content="width=device-width"><meta name="description" content="Family dentist">
<script type="application/ld+json">{}</script></head><body>
<a href="mailto:Hello@acme-dental.com?subject=x">Email</a> <a href="tel:+17185551234">Call</a>
<a href="https://www.facebook.com/acmedental/">fb</a> <a href="https://www.facebook.com/sharer/sharer.php?u=1">share</a>
<a href="/contact-us">Contact</a><a href="/about">About</a>
<script src="https://assets.calendly.com/assets/external/widget.js"></script>
<form action="/send"><input type="email" name="email"><textarea></textarea></form>
<img src="logo@2x.png"> hidden@2x.png
<footer>© 2019 Acme Dental</footer></body></html>`;

describe("website analysis (pure HTML)", () => {
  const a = analyzeHtml(HTML, "https://acme-dental.com/");
  it("extracts published emails, phones, social links and contact page", () => {
    expect(a.emails.map((e) => e.email)).toEqual(["hello@acme-dental.com"]);
    expect(a.phones).toEqual(["+17185551234"]);
    expect(a.social.facebook).toBe("https://www.facebook.com/acmedental");
    expect(a.contactPageUrl).toBe("https://acme-dental.com/contact-us");
  });
  it("detects signals with evidence levels", () => {
    expect(a.signals.booking).toBe("detected");
    expect(a.signals.viewport).toBe("detected");
    expect(a.signals.contactForm).toBe("detected");
    expect(a.signals.chat).toBe("not_detected");
    expect(a.signals.copyrightYear).toBe(2019);
  });
  it("does not glue adjacent elements into bogus emails (regression from live test)", () => {
    const html = '<html><body><p>Write to <b>nova@acme-corp.com</b>Services</p><div>worldwide.nova@acme-corp.com</div><span>Work</span><script type="application/ld+json">{}</script></body></html>';
    const r = analyzeHtml(html, "https://acme-corp.com/");
    expect(r.emails.map((e) => e.email).sort()).toEqual(["nova@acme-corp.com", "worldwide.nova@acme-corp.com"]);
    expect(r.signals.structuredData).toBe("detected"); // scripts are still inspected for signals
  });
  it("legacy markup needs real DOM evidence — not stray text in scripts (regression from live test)", () => {
    const modern = '<html><body><center>one</center><script>var t="<font><marquee>";</script><p>© 2026 Acme</p></body></html>';
    expect(analyzeHtml(modern, "https://a.test/").signals.legacyMarkup).toBe("not_detected");
    const old = '<html><body><marquee>Welcome!</marquee></body></html>';
    expect(analyzeHtml(old, "https://a.test/").signals.legacyMarkup).toBe("detected");
    const fonts = '<html><body><font>a</font><font>b</font><font>c</font></body></html>';
    expect(analyzeHtml(fonts, "https://a.test/").signals.legacyMarkup).toBe("detected");
  });
  it("normalises urls/domains", () => {
    expect(normalizeUrl("acme.com")).toBe("https://acme.com/");
    expect(normalizeUrl("not a url")).toBeNull();
    expect(domainOf("http://www.Acme.com/x")).toBe("acme.com");
  });
});

describe("robots.txt", () => {
  const rules = parseRobots(`User-agent: *\nDisallow: /private\nAllow: /private/public\n\nUser-agent: OrbiTechLeadBot\nDisallow: /nobot`);
  it("prefers our own group, longest match wins", () => {
    expect(isAllowedByRules(rules, "/nobot/x")).toBe(false);
    expect(isAllowedByRules(rules, "/private")).toBe(true); // bot-specific group replaces '*'
    const star = parseRobots(`User-agent: *\nDisallow: /private\nAllow: /private/public`);
    expect(isAllowedByRules(star, "/private/x")).toBe(false);
    expect(isAllowedByRules(star, "/private/public/x")).toBe(true);
    expect(isAllowedByRules(parseRobots(`User-agent: *\nDisallow: /`), "/")).toBe(false);
  });
});

describe("SSRF guard", () => {
  it("identifies private addresses", () => {
    for (const ip of ["127.0.0.1", "10.0.0.5", "192.168.1.1", "172.20.0.1", "169.254.169.254", "::1", "fd00::1"]) expect(isPrivateIp(ip), ip).toBe(true);
    expect(isPrivateIp("8.8.8.8")).toBe(false);
  });
  it("a non-existent domain is a DNS 'not found' (evidence of unreachability), not a safety block", async () => {
    await expect(assertPublicUrl("http://this-domain-should-not-exist-orbitech-123.invalid/")).rejects.toBeInstanceOf(DnsNotFoundError);
  });
  it("blocks non-public URLs before any request", async () => {
    for (const u of ["http://localhost/", "http://127.0.0.1:3000", "http://169.254.169.254/latest/meta-data", "file:///etc/passwd", "ftp://x.com", "http://user:pw@example.com"]) {
      await expect(assertPublicUrl(u), u).rejects.toBeInstanceOf(BlockedUrlError);
    }
  });
});

describe("connectors (parsing, no network)", () => {
  it("builds tag and keyword Overpass queries safely", () => {
    const q = buildOverpassQuery(dental, 40.6782, -73.9442, 5, 100);
    expect(q).toContain('["amenity"="dentist"]["name"]');
    expect(q).toContain("(around:5000,40.678200,-73.944200)");
    expect(q).toContain("out center meta tags 100;");
    expect(q).toContain("[timeout:45]");
    const kq = buildOverpassQuery(customNiche('Drone "repair" (pro)'), 1, 2, 1, 10);
    expect(kq).toContain('["name"~"drone \\"repair\\" \\\\(pro\\\\)",i]["shop"]');
  });
  it("parses an OSM element and labels how it matched", () => {
    const r = parseOsmElement(
      { type: "node", id: 1, lat: 40.68, lon: -73.95, timestamp: "2026-06-01T00:00:00Z", tags: { name: "Bed-Sty Dental Arts", amenity: "dentist", phone: "+1-718-622-8950", website: "https://bedstuydentalarts.com", "addr:housenumber": "456", "addr:street": "Schenectady Avenue", "addr:postcode": "11203" } },
      dental,
    )!;
    expect(r.matchBasis).toBe("tag");
    expect(r.address).toBe("456 Schenectady Avenue, 11203");
    expect(r.sourceUrl).toBe("https://www.openstreetmap.org/node/1");
    expect(r.email).toBeUndefined(); // never invented
    expect(parseOsmElement({ type: "node", id: 2, tags: { amenity: "dentist" } }, dental)).toBeNull(); // unnamed
  });
  it("parses a Google Places result", () => {
    const r = parseGooglePlace(
      { id: "abc", displayName: { text: "Acme" }, formattedAddress: "1 Main St", location: { latitude: 1, longitude: 2 }, rating: 4.6, userRatingCount: 120, websiteUri: "https://acme.com", internationalPhoneNumber: "+1 718-555-1234", addressComponents: [{ longText: "Brooklyn", shortText: "Brooklyn", types: ["locality"] }, { longText: "United States", shortText: "US", types: ["country"] }] },
      dental.id,
    )!;
    expect(r).toMatchObject({ source: "google_places", city: "Brooklyn", country: "US", rating: 4.6, reviewCount: 120, matchBasis: "api" });
    expect(parseGooglePlace({ id: "x" }, "n")).toBeNull();
  });
});
