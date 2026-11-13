import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";

export type PhoneStatus = "valid_format" | "possible" | "invalid" | "unverified";

export interface PhoneResult {
  raw: string;
  e164?: string;
  international?: string;
  country?: string;
  type?: string; // MOBILE | FIXED_LINE | FIXED_LINE_OR_MOBILE | TOLL_FREE | ...
  status: PhoneStatus;
  note: string;
}

/**
 * Normalise and validate a phone number against libphonenumber metadata.
 * IMPORTANT: "valid_format" only means the number is well-formed for its region.
 * It does NOT mean the line is active or belongs to the business.
 */
export function checkPhone(raw: string | null | undefined, defaultCountry?: string): PhoneResult | null {
  const input = (raw ?? "").trim();
  if (!input) return null;
  // OSM often holds several numbers separated by ';' — take the first.
  const first = input.split(/[;,/]|\bor\b/i)[0].trim();
  const cc = defaultCountry && /^[A-Za-z]{2}$/.test(defaultCountry) ? (defaultCountry.toUpperCase() as CountryCode) : undefined;
  let parsed;
  try {
    parsed = parsePhoneNumberFromString(first, cc);
  } catch {
    parsed = undefined;
  }
  if (!parsed) return { raw: input, status: "invalid", note: "Could not be parsed as a phone number." };
  const base = {
    raw: input,
    e164: parsed.number,
    international: parsed.formatInternational(),
    country: parsed.country,
    type: parsed.getType(),
  };
  if (parsed.isValid()) {
    return { ...base, status: "valid_format", note: "Format valid for its region. Line activity is not verified." };
  }
  if (parsed.isPossible()) {
    return { ...base, status: "possible", note: "Length plausible but not a recognised numbering plan range." };
  }
  return { ...base, status: "invalid", note: "Not a valid number for its region." };
}

export function normalizePhoneKey(raw: string | null | undefined, defaultCountry?: string): string | null {
  const r = checkPhone(raw, defaultCountry);
  return r?.e164 && r.status !== "invalid" ? r.e164 : null;
}
