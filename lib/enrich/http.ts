import dns from "node:dns/promises";
import net from "node:net";

/** Identity for third-party data APIs (Overpass, Nominatim). Public OSM services refuse or stall UAs that look like scrapers ("bot"). */
export const API_USER_AGENT = process.env.API_USER_AGENT ?? "OrbiTechLeadIntelligence/0.1 (https://theorbitechsolution.com)";

/** Identity for fetching business websites. Deliberately transparent; robots.txt rules for "OrbiTechLeadBot" are honoured. */
export const USER_AGENT =
  process.env.CRAWLER_USER_AGENT ??
  "OrbiTechLeadBot/0.1 (+https://theorbitechsolution.com/bot; business-contact enrichment; respects robots.txt)";

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 10 || a === 127 || a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l.startsWith("::ffff:")) return isPrivateIp(l.slice(7));
    return l === "::1" || l === "::" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80");
  }
  return true;
}

export class BlockedUrlError extends Error {}

/** The hostname does not resolve. Distinct from a safety block: this is evidence the site is unreachable. */
export class DnsNotFoundError extends Error {
  constructor(public host: string) {
    super("Domain does not resolve (DNS).");
  }
}

/** Throws if the URL is not public http(s). Resolves DNS and rejects private/loopback/link-local targets (SSRF guard). */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new BlockedUrlError("Invalid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new BlockedUrlError("Only http(s) URLs are allowed");
  if (u.username || u.password) throw new BlockedUrlError("Credentials in URL are not allowed");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new BlockedUrlError("Local hostnames are not allowed");
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new BlockedUrlError("Private IP not allowed");
    return u;
  }
  try {
    const addrs = await dns.lookup(host, { all: true });
    if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new BlockedUrlError("Host resolves to a private address");
  } catch (e) {
    if (e instanceof BlockedUrlError) throw e;
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOTFOUND" || code === "ENODATA") throw new DnsNotFoundError(host);
    throw new BlockedUrlError(`DNS lookup failed (${code ?? "error"})`); // temporary failure: unknown, not proof of absence
  }
  return u;
}

export interface FetchResult {
  ok: boolean;
  status: number;
  finalUrl: string;
  redirected: boolean;
  headers: Headers;
  body: string;
  ms: number;
  bytes: number;
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  method?: "GET" | "HEAD";
  signal?: AbortSignal;
}

/** Fetch with SSRF checks on every hop, timeout, redirect cap and response-size cap. */
export async function safeFetch(url: string, opts: SafeFetchOptions = {}): Promise<FetchResult> {
  const { timeoutMs = 10000, maxBytes = 1_500_000, maxRedirects = 5, method = "GET" } = opts;
  const started = Date.now();
  let current = url;
  let redirected = false;
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicUrl(current);
    const res = await fetch(current, {
      method,
      redirect: "manual",
      signal,
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,*/*;q=0.8", "accept-language": "en" },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location")!, current).toString();
      redirected = true;
      await res.body?.cancel().catch(() => {});
      continue;
    }
    let body = "";
    let bytes = 0;
    if (method === "GET" && res.body) {
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        chunks.push(value);
        if (bytes >= maxBytes) {
          await reader.cancel().catch(() => {});
          break;
        }
      }
      body = new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
    }
    return { ok: res.ok, status: res.status, finalUrl: current, redirected, headers: res.headers, body, ms: Date.now() - started, bytes };
  }
  throw new Error("Too many redirects");
}

/** Extract a network error code (e.g. CERT_HAS_EXPIRED, ENOTFOUND) from a fetch failure. */
export function errorCode(e: unknown): string {
  const err = e as { cause?: { code?: string }; code?: string; name?: string; message?: string };
  return err?.cause?.code ?? err?.code ?? (err?.name === "TimeoutError" || err?.name === "AbortError" ? "TIMEOUT" : err?.message ?? "UNKNOWN");
}

export const CERT_ERRORS = new Set([
  "CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "ERR_TLS_CERT_ALTNAME_INVALID", "CERT_NOT_YET_VALID", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "ERR_SSL_WRONG_VERSION_NUMBER",
]);
