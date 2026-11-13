import "server-only";
import ExcelJS from "exceljs";
import { eq, inArray } from "drizzle-orm";
import { getDb, schema } from "../db";
import { leadWhere, type LeadFilter } from "../services/leads";
import type { LeadRow } from "../search/facts";

const { leads, suppressions, leadSources } = schema;

export interface ExportColumn {
  key: string;
  header: string;
  get: (l: LeadRow, ctx: { sources: string[]; sourceUrls: string[] }) => string | number | null | undefined;
}

const iso = (d: Date | null) => (d ? d.toISOString() : "");

export const EXPORT_COLUMNS: ExportColumn[] = [
  { key: "name", header: "Business Name", get: (l) => l.name },
  { key: "industry", header: "Industry", get: (l) => l.industry },
  { key: "subcategory", header: "Subcategory", get: (l) => l.subcategory },
  { key: "country", header: "Country", get: (l) => l.country },
  { key: "state", header: "State/Province", get: (l) => l.state },
  { key: "city", header: "City", get: (l) => l.city },
  { key: "address", header: "Address", get: (l) => l.address },
  { key: "postcode", header: "ZIP/Postal Code", get: (l) => l.postcode },
  { key: "phone", header: "Phone (international)", get: (l) => l.phone },
  { key: "phone_e164", header: "Phone (E.164)", get: (l) => l.phoneE164 },
  { key: "phone_status", header: "Phone Status", get: (l) => l.phoneStatus },
  { key: "email", header: "Email", get: (l) => l.email },
  { key: "email_status", header: "Email Status", get: (l) => l.emailStatus },
  { key: "email_source", header: "Email Source URL", get: (l) => l.emailSourceUrl },
  { key: "website", header: "Website", get: (l) => l.website },
  { key: "maps", header: "Google Maps URL", get: (l) => l.mapsUrl },
  { key: "rating", header: "Rating", get: (l) => l.rating },
  { key: "reviews", header: "Reviews", get: (l) => l.reviewCount },
  { key: "facebook", header: "Facebook", get: (l) => l.facebook },
  { key: "instagram", header: "Instagram", get: (l) => l.instagram },
  { key: "linkedin", header: "LinkedIn", get: (l) => l.linkedin },
  { key: "description", header: "Business Description", get: (l) => l.description },
  { key: "contact_person", header: "Contact Person", get: (l) => l.contactPerson },
  { key: "position", header: "Position", get: (l) => l.contactPosition },
  {
    key: "opportunities",
    header: "Opportunities",
    get: (l) => (l.opportunities as { label: string; certainty: string }[]).map((o) => `${o.label} [${o.certainty}]`).join("; "),
  },
  { key: "score", header: "Lead Score (0-100)", get: (l) => l.score },
  { key: "classification", header: "Classification", get: (l) => l.classification },
  { key: "source", header: "Source(s)", get: (_l, c) => c.sources.join("; ") },
  { key: "source_urls", header: "Source URL(s)", get: (_l, c) => c.sourceUrls.join(" | ") },
  { key: "last_verified", header: "Last Verified", get: (l) => iso(l.lastVerifiedAt) },
  { key: "verification", header: "Verification Status", get: (l) => l.verificationStatus },
  { key: "status", header: "Pipeline Status", get: (l) => l.status },
  { key: "tags", header: "Tags", get: (l) => l.tags.join("; ") },
  { key: "discovered", header: "Discovered At", get: (l) => iso(l.createdAt) },
];

export const DEFAULT_EXPORT_KEYS = EXPORT_COLUMNS.map((c) => c.key);

/** Neutralise spreadsheet formula injection (cells starting with = + - @ tab CR). Pure phone numbers are left intact. */
export function safeCell(v: unknown): string | number {
  if (v == null) return "";
  if (typeof v === "number") return v;
  const s = String(v);
  if (/^\+\d[\d ()-]*$/.test(s)) return s;
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

export function toCsv(headers: string[], rows: (string | number)[][], opts: { bom?: boolean } = {}): string {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [headers, ...rows].map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
  return (opts.bom ? "﻿" : "") + body;
}

export interface ExportResult {
  filename: string;
  contentType: string;
  body: Buffer | string;
  count: number;
  excluded: number;
}

/**
 * Build an export. Restricted data never leaves: leads flagged do-not-contact or on a suppressed domain are
 * excluded; suppressed emails/phones are blanked.
 */
export async function buildExport(orgId: string, filter: LeadFilter, format: "csv" | "xls" | "xlsx" | "json", keys?: string[], meta: Record<string, unknown> = {}): Promise<ExportResult> {
  const db = await getDb();
  const cols = EXPORT_COLUMNS.filter((c) => !keys?.length || keys.includes(c.key));
  const rows = await db.select().from(leads).where(leadWhere(orgId, filter)).limit(50_000);
  const sup = await db.select().from(suppressions).where(eq(suppressions.orgId, orgId));
  const supSet = { email: new Set(sup.filter((s) => s.type === "email").map((s) => s.value)), phone: new Set(sup.filter((s) => s.type === "phone").map((s) => s.value)), domain: new Set(sup.filter((s) => s.type === "domain").map((s) => s.value)) };

  const srcRows = rows.length
    ? await db.select().from(leadSources).where(inArray(leadSources.leadId, rows.map((r) => r.id)))
    : [];
  const srcByLead = new Map<string, { sources: string[]; urls: string[] }>();
  for (const s of srcRows) {
    const e = srcByLead.get(s.leadId) ?? { sources: [], urls: [] };
    if (!e.sources.includes(s.source)) e.sources.push(s.source);
    if (s.sourceUrl) e.urls.push(s.sourceUrl);
    srcByLead.set(s.leadId, e);
  }

  let excluded = 0;
  const kept: { lead: LeadRow; ctx: { sources: string[]; sourceUrls: string[] } }[] = [];
  for (const l of rows) {
    if (l.doNotContact || (l.websiteDomain && supSet.domain.has(l.websiteDomain))) {
      excluded++;
      continue;
    }
    const lead = { ...l };
    if (lead.email && supSet.email.has(lead.email.toLowerCase())) lead.email = null;
    if (lead.phoneE164 && supSet.phone.has(lead.phoneE164)) {
      lead.phone = null;
      lead.phoneE164 = null;
    }
    const s = srcByLead.get(l.id);
    kept.push({ lead, ctx: { sources: s?.sources ?? [l.sourcePrimary], sourceUrls: s?.urls ?? [] } });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const base = `leads-${stamp}`;
  if (format === "json") {
    const data = kept.map(({ lead, ctx }) => Object.fromEntries(cols.map((c) => [c.key, c.get(lead, ctx) ?? null])));
    return { filename: `${base}.json`, contentType: "application/json", body: JSON.stringify({ exportedAt: new Date().toISOString(), count: data.length, excludedRestricted: excluded, meta, leads: data }, null, 2), count: data.length, excluded };
  }
  const matrix = kept.map(({ lead, ctx }) => cols.map((c) => c.get(lead, ctx)));
  if (format === "csv" || format === "xls") {
    // "xls" = Excel-friendly CSV (UTF-8 BOM so accents survive when double-clicked in Excel).
    const body = toCsv(cols.map((c) => c.header), matrix.map((r) => r.map(safeCell)), { bom: true });
    return { filename: `${base}.csv`, contentType: "text/csv; charset=utf-8", body, count: kept.length, excluded };
  }
  const wb = new ExcelJS.Workbook();
  wb.creator = "OrbiTech Lead Intelligence";
  const ws = wb.addWorksheet("Leads", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: Math.min(46, Math.max(14, c.header.length + 4)) }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
  for (const r of matrix) {
    const row = ws.addRow(r.map((v) => (v == null ? "" : typeof v === "number" ? v : String(v))));
    // Keep phone numbers as text so the leading + and zeros survive.
    cols.forEach((c, i) => {
      if (c.key === "phone" || c.key === "phone_e164" || c.key === "postcode") row.getCell(i + 1).numFmt = "@";
    });
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  const info = wb.addWorksheet("Export info");
  info.addRows([
    ["Exported at", new Date().toISOString()],
    ["Leads exported", kept.length],
    ["Excluded (do-not-contact / suppressed)", excluded],
    ...Object.entries(meta).map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : String(v)]),
    ["Note", "Lead score measures data quality and opportunity, not sale probability. Verify contact details before outreach."],
  ]);
  info.getColumn(1).width = 38;
  info.getColumn(2).width = 80;
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return { filename: `${base}.xlsx`, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", body: buf, count: kept.length, excluded };
}

