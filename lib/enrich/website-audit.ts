import * as cheerio from "cheerio";
import { CERT_ERRORS, DnsNotFoundError, errorCode, safeFetch, BlockedUrlError } from "./http";
import { robotsAllows } from "./robots";

/**
 * Evidence levels — we never claim a feature is missing just because we did not see it.
 *  detected        positive evidence found
 *  verified_absent we directly verified the absence (e.g. no website, HTTP only, unreachable)
 *  not_detected    looked on the fetched page, found nothing (may be JS-rendered / on another page)
 *  unknown         could not check
 */
export type Evidence = "detected" | "verified_absent" | "not_detected" | "unknown";

export interface WebsiteAudit {
  url: string;
  finalUrl?: string;
  checkedAt: string;
  reachable: Evidence; // detected = reachable, verified_absent = unreachable
  httpStatus?: number;
  error?: string;
  responseMs?: number;
  pageKb?: number;
  https: Evidence; // detected = served over valid HTTPS, verified_absent = no HTTPS / invalid cert
  httpsNote?: string;
  redirected?: boolean;
  robotsAllowed: boolean;
  title?: string;
  signals: {
    viewport: Evidence;
    contactForm: Evidence;
    booking: Evidence;
    onlineOrdering: Evidence;
    chat: Evidence;
    crmOrMarketing: Evidence;
    structuredData: Evidence;
    legacyMarkup: Evidence;
    copyrightYear?: number;
    generator?: string;
  };
  brokenLinks: { checked: number; broken: string[] };
  contacts: {
    emails: { email: string; url: string }[];
    phones: string[];
    social: { facebook?: string; instagram?: string; linkedin?: string; twitter?: string; youtube?: string; tiktok?: string };
    contactPageUrl?: string;
  };
  description?: string;
  notes: string[];
}

const BOOKING = /calendly\.com|acuityscheduling|squareup\.com\/appointments|book(?:ing)?\.(?:fresha|booksy)|booksy\.com|fresha\.com|mindbodyonline|opentable\.com|resy\.com|zocdoc|setmore|simplybook|vagaro|schedulicity|jane\.app|janeapp|book\s*(?:now|online|an? appointment|a table|a session)|schedule\s*(?:an?\s*)?(?:appointment|visit|online)|request\s*(?:an?\s*)?appointment|reserve\s*(?:a\s*)?table|make\s*(?:a\s*)?reservation/i;
const ORDERING = /toasttab\.com|doordash\.com|ubereats\.com|grubhub\.com|chownow\.com|menulog|order\.online|order\s*(?:online|now|pickup|delivery)|add[\s-]to[\s-]cart|woocommerce|cdn\.shopify\.com|\/cart\b|snipcart|bigcommerce/i;
const CHAT = /tawk\.to|embed\.tawk|intercom|drift\.com|crisp\.chat|livechatinc|tidio|js\.hs-scripts\.com|hubspot\.com\/conversations|zopim|zendesk|freshchat|olark|smartsupp|manychat|chatbot|widget\.(?:leadconnector|gohighlevel)|messenger-plugin|fb-customerchat/i;
const CRM = /hs-scripts\.com|hubspot|pardot|salesforce|zoho|activecampaign|mailchimp|klaviyo|gohighlevel|leadconnector|pipedrive|keap|infusionsoft|marketo|sendinblue|brevo|convertkit|zapier/i;
const EMAIL_IN_TEXT = /[a-z0-9._%+-]{1,64}@(?:[a-z0-9-]+\.)+[a-z]{2,24}/gi;
const BAD_EMAIL_DOMAINS = /(^|\.)(example\.com|sentry\.io|sentry-next\.wixpress\.com|wixpress\.com|domain\.com|email\.com|yourdomain\.com|godaddy\.com)$/i;
const BAD_EMAIL_LOCAL = /^(you|your|name|email|user|username|test|example|john\.?doe)$/i;

function normalizeSocial(href: string, host: RegExp): string | undefined {
  try {
    const u = new URL(href);
    if (!host.test(u.hostname)) return undefined;
    if (/\/(sharer|share|intent|dialog|plugins|tr)(\/|\?|$)/i.test(u.pathname)) return undefined;
    return u.origin + u.pathname.replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

/**
 * Legacy markup, judged from real DOM elements (not text that merely appears in scripts or templates),
 * and only on strong evidence: deprecated presentational elements used repeatedly, or Flash embeds.
 */
function hasLegacyMarkup($: cheerio.CheerioAPI): boolean {
  return (
    $("marquee, blink, frameset, frame").length > 0 ||
    $("font").length >= 3 ||
    $("center").length >= 3 ||
    $('embed[src$=".swf"], object[data$=".swf"], param[value$=".swf"]').length > 0
  );
}

/** Pure HTML analysis (no network). Exported for unit tests. */
export function analyzeHtml(html: string, pageUrl: string) {
  const $ = cheerio.load(html);
  const lower = html.toLowerCase();
  // Strip tags to spaces (not to ""), otherwise adjacent elements glue together ("a@b.comServices").
  const bodyClone = $("body").clone();
  bodyClone.find("script,style,noscript,template").remove();
  const text = (bodyClone.html() ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#64;|&commat;/g, "@")
    .replace(/\s+/g, " ");

  const emails = new Map<string, string>();
  const addEmail = (raw: string) => {
    const e = raw.trim().toLowerCase().replace(/^mailto:/, "").split("?")[0];
    const [local, domain] = e.split("@");
    if (!local || !domain || BAD_EMAIL_DOMAINS.test(domain) || BAD_EMAIL_LOCAL.test(local)) return;
    if (/\.(png|jpe?g|gif|svg|webp|css|js)$/i.test(domain)) return;
    emails.set(e, pageUrl);
  };
  $('a[href^="mailto:"]').each((_, el) => addEmail($(el).attr("href") ?? ""));
  for (const m of text.match(EMAIL_IN_TEXT) ?? []) addEmail(m);

  const phones = new Set<string>();
  $('a[href^="tel:"]').each((_, el) => {
    const p = decodeURIComponent($(el).attr("href")!.slice(4)).trim();
    if (p) phones.add(p);
  });

  const social: WebsiteAudit["contacts"]["social"] = {};
  const links: string[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href")!;
    let abs: string;
    try {
      abs = new URL(href, pageUrl).toString();
    } catch {
      return;
    }
    links.push(abs);
    social.facebook ??= normalizeSocial(abs, /(^|\.)facebook\.com$/i);
    social.instagram ??= normalizeSocial(abs, /(^|\.)instagram\.com$/i);
    social.linkedin ??= normalizeSocial(abs, /(^|\.)linkedin\.com$/i);
    social.twitter ??= normalizeSocial(abs, /(^|\.)(twitter|x)\.com$/i);
    social.youtube ??= normalizeSocial(abs, /(^|\.)youtube\.com$/i);
    social.tiktok ??= normalizeSocial(abs, /(^|\.)tiktok\.com$/i);
  });

  const origin = new URL(pageUrl).origin;
  const internal = [...new Set(links.filter((l) => l.startsWith(origin) && !/#|\.(pdf|jpe?g|png|gif|zip|mp4)$/i.test(l)))];
  const contactPageUrl = internal.find((l) => /contact|get-in-touch|reach-us/i.test(new URL(l).pathname));

  const hasForm = $("form").filter((_, f) => {
    const t = $(f).text().toLowerCase() + " " + ($(f).attr("action") ?? "");
    return $(f).find("textarea, input[type=email], input[name*=email i]").length > 0 && !/search|login|log in|subscribe|newsletter/.test(t.slice(0, 200));
  }).length > 0;

  const years = [...text.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/gi)].map((m) => Number(m[1])).filter((y) => y > 1995 && y <= 2100);
  const copyrightYear = years.length ? Math.max(...years) : undefined;

  const evidence = (re: RegExp): Evidence => (re.test(lower) ? "detected" : "not_detected");

  return {
    title: $("title").first().text().trim().slice(0, 200) || undefined,
    description:
      ($('meta[name="description"]').attr("content") ?? $('meta[property="og:description"]').attr("content") ?? "").trim().slice(0, 500) || undefined,
    signals: {
      viewport: $('meta[name="viewport"]').length ? ("detected" as Evidence) : "not_detected",
      contactForm: hasForm ? ("detected" as Evidence) : "not_detected",
      booking: evidence(BOOKING),
      onlineOrdering: evidence(ORDERING),
      chat: evidence(CHAT),
      crmOrMarketing: evidence(CRM),
      structuredData: $('script[type="application/ld+json"]').length ? ("detected" as Evidence) : "not_detected",
      legacyMarkup: hasLegacyMarkup($) ? ("detected" as Evidence) : "not_detected",
      copyrightYear,
      generator: $('meta[name="generator"]').attr("content")?.slice(0, 80),
    },
    emails: [...emails].map(([email, url]) => ({ email, url })),
    phones: [...phones],
    social,
    internalLinks: internal,
    contactPageUrl,
  };
}

async function checkLinks(links: string[], max = 8): Promise<{ checked: number; broken: string[] }> {
  const sample = links.slice(0, max);
  const broken: string[] = [];
  await Promise.all(
    sample.map(async (l) => {
      try {
        if (!(await robotsAllows(l))) return;
        let r = await safeFetch(l, { method: "HEAD", timeoutMs: 6000 });
        if (r.status === 405 || r.status === 501) r = await safeFetch(l, { timeoutMs: 6000, maxBytes: 20_000 });
        if (r.status >= 400 && r.status !== 401 && r.status !== 403 && r.status !== 429) broken.push(l);
      } catch (e) {
        if (!(e instanceof BlockedUrlError)) broken.push(l); // DnsNotFoundError counts as broken; safety blocks do not
      }
    }),
  );
  return { checked: sample.length, broken };
}

export function normalizeUrl(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  try {
    const u = new URL(s);
    return u.hostname.includes(".") ? u.toString() : null;
  } catch {
    return null;
  }
}

export function domainOf(raw: string | null | undefined): string | null {
  const n = raw ? normalizeUrl(raw) : null;
  if (!n) return null;
  return new URL(n).hostname.toLowerCase().replace(/^www\./, "");
}

/**
 * Audit a business website. Visits the homepage (+ contact page if linked), honours robots.txt,
 * checks HTTPS validity, response time, and samples a few internal links.
 */
export async function auditWebsite(rawUrl: string, opts: { checkLinks?: boolean } = {}): Promise<WebsiteAudit> {
  const url = normalizeUrl(rawUrl);
  const base: WebsiteAudit = {
    url: rawUrl,
    checkedAt: new Date().toISOString(),
    reachable: "unknown",
    https: "unknown",
    robotsAllowed: true,
    signals: {
      viewport: "unknown", contactForm: "unknown", booking: "unknown", onlineOrdering: "unknown", chat: "unknown",
      crmOrMarketing: "unknown", structuredData: "unknown", legacyMarkup: "unknown",
    },
    brokenLinks: { checked: 0, broken: [] },
    contacts: { emails: [], phones: [], social: {} },
    notes: [],
  };
  if (!url) {
    base.notes.push("Website value is not a valid URL.");
    return base;
  }
  base.url = url;

  // Try HTTPS first so we can verify certificate validity; fall back to HTTP.
  const httpsUrl = url.replace(/^http:/i, "https:");
  let res;
  try {
    if (!(await robotsAllows(httpsUrl))) {
      base.robotsAllowed = false;
      base.notes.push("robots.txt disallows automated access; page was not fetched.");
      return base;
    }
    res = await safeFetch(httpsUrl);
    base.https = "detected";
  } catch (e) {
    const code = errorCode(e);
    if (e instanceof DnsNotFoundError) {
      base.reachable = "verified_absent";
      base.error = e.message;
      return base;
    }
    if (e instanceof BlockedUrlError) {
      base.error = e.message;
      base.notes.push(`Blocked by safety policy: ${e.message}`);
      return base;
    }
    if (CERT_ERRORS.has(code)) {
      base.https = "verified_absent";
      base.httpsNote = `HTTPS certificate problem (${code}).`;
    } else if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
      base.reachable = "verified_absent";
      base.error = "Domain does not resolve (DNS).";
      return base;
    } else {
      base.httpsNote = `HTTPS connection failed (${code}).`;
    }
    try {
      res = await safeFetch(url.replace(/^https:/i, "http:"));
      if (base.https === "unknown") base.https = "verified_absent";
    } catch (e2) {
      base.reachable = "verified_absent";
      base.error = `Unreachable (${errorCode(e2)}).`;
      return base;
    }
  }

  base.httpStatus = res.status;
  base.finalUrl = res.finalUrl;
  base.redirected = res.redirected;
  base.responseMs = res.ms;
  base.pageKb = Math.round(res.bytes / 1024);
  if (!res.ok) {
    base.reachable = res.status >= 500 || res.status === 404 || res.status === 410 ? "verified_absent" : "unknown";
    base.error = `HTTP ${res.status}`;
    if (res.status === 401 || res.status === 403 || res.status === 429) base.notes.push("Site blocks automated access; manual review needed.");
    return base;
  }
  base.reachable = "detected";
  if (res.finalUrl.startsWith("http:")) base.https = "verified_absent";

  const a = analyzeHtml(res.body, res.finalUrl);
  base.title = a.title;
  base.description = a.description;
  base.signals = { ...base.signals, ...a.signals };
  base.contacts = { emails: a.emails, phones: a.phones, social: a.social, contactPageUrl: a.contactPageUrl };

  // Contact page: often where the business email lives.
  if (a.contactPageUrl && (await robotsAllows(a.contactPageUrl).catch(() => false))) {
    try {
      const c = await safeFetch(a.contactPageUrl, { timeoutMs: 8000 });
      if (c.ok) {
        const ca = analyzeHtml(c.body, c.finalUrl);
        const seen = new Set(base.contacts.emails.map((e) => e.email));
        for (const e of ca.emails) if (!seen.has(e.email)) base.contacts.emails.push(e);
        base.contacts.phones = [...new Set([...base.contacts.phones, ...ca.phones])];
        for (const [k, v] of Object.entries(ca.social)) {
          const key = k as keyof typeof base.contacts.social;
          base.contacts.social[key] ??= v;
        }
        if (ca.signals.contactForm === "detected") base.signals.contactForm = "detected";
        for (const k of ["booking", "chat", "onlineOrdering"] as const) if (ca.signals[k] === "detected") base.signals[k] = "detected";
      }
    } catch {
      /* contact page failure is non-fatal */
    }
  }

  if (opts.checkLinks !== false) base.brokenLinks = await checkLinks(a.internalLinks);
  base.notes.push("Signals come from the homepage (and contact page). JavaScript-rendered widgets may not be visible; 'not_detected' is not proof of absence.");
  return base;
}
