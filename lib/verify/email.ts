import dns from "node:dns/promises";

export type EmailStatus = "domain_verified" | "valid_format" | "uncertain" | "invalid" | "unverified";

export interface EmailResult {
  email: string;
  status: EmailStatus;
  reasons: string[];
}

// A small built-in list of disposable providers. Extend via DISPOSABLE_EMAIL_DOMAINS (comma-separated).
const DISPOSABLE = new Set([
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com", "temp-mail.org",
  "yopmail.com", "trashmail.com", "sharklasers.com", "getnada.com", "dispostable.com",
  "maildrop.cc", "throwawaymail.com", "fakeinbox.com", "mailnesia.com", "mintemail.com",
]);
for (const d of (process.env.DISPOSABLE_EMAIL_DOMAINS ?? "").split(",")) if (d.trim()) DISPOSABLE.add(d.trim().toLowerCase());

const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/i;

export function validateEmailSyntax(email: string): boolean {
  const e = email.trim();
  if (e.length > 254 || e.includes("..") || e.startsWith(".") || e.includes(".@")) return false;
  return EMAIL_RE.test(e);
}

export function isDisposable(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  return !!domain && DISPOSABLE.has(domain);
}

export type MxResolver = (domain: string) => Promise<"mx" | "a-only" | "none" | "error">;

const defaultResolver: MxResolver = async (domain) => {
  const withTimeout = <T,>(p: Promise<T>) =>
    Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("dns-timeout")), 4000))]);
  try {
    const mx = await withTimeout(dns.resolveMx(domain));
    if (mx.length) return "mx";
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== "ENODATA" && code !== "ENOTFOUND") return "error";
  }
  try {
    const a = await withTimeout(dns.resolve4(domain));
    return a.length ? "a-only" : "none";
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return code === "ENODATA" || code === "ENOTFOUND" ? "none" : "error";
  }
};

/**
 * Syntax -> disposable -> DNS (MX). No mail is ever sent. SMTP probing is intentionally not performed.
 * "domain_verified" means the domain accepts mail; the mailbox itself is not confirmed.
 */
export async function checkEmail(email: string | null | undefined, resolver: MxResolver = defaultResolver): Promise<EmailResult | null> {
  const e = (email ?? "").trim().toLowerCase();
  if (!e) return null;
  if (!validateEmailSyntax(e)) return { email: e, status: "invalid", reasons: ["Invalid email syntax."] };
  if (isDisposable(e)) return { email: e, status: "invalid", reasons: ["Disposable email provider."] };
  const domain = e.split("@")[1];
  const res = await resolver(domain);
  switch (res) {
    case "mx":
      return { email: e, status: "domain_verified", reasons: ["Domain has MX records. Mailbox existence not confirmed."] };
    case "a-only":
      return { email: e, status: "uncertain", reasons: ["Domain has no MX record; falls back to an A record. Deliverability uncertain."] };
    case "none":
      return { email: e, status: "invalid", reasons: ["Domain does not exist or cannot receive mail."] };
    default:
      return { email: e, status: "valid_format", reasons: ["Syntax valid; DNS lookup failed or timed out, so the domain was not checked."] };
  }
}
