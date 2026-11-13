"use client";
import { AlertTriangle, CheckCircle2, CircleHelp, ShieldAlert, XCircle } from "lucide-react";
import { Badge } from "./ui";

export const CLASS_LABEL: Record<string, string> = {
  high_priority: "High Priority",
  good_potential: "Good Potential",
  moderate_potential: "Moderate Potential",
  low_priority: "Low Priority",
  needs_verification: "Needs Verification",
};
const CLASS_TONE = { high_priority: "success", good_potential: "accent", moderate_potential: "info", low_priority: "neutral", needs_verification: "warn" } as const;

export function ClassBadge({ value }: { value: string }) {
  return <Badge tone={CLASS_TONE[value as keyof typeof CLASS_TONE] ?? "neutral"}>{CLASS_LABEL[value] ?? value}</Badge>;
}

export const VERIFY_LABEL: Record<string, string> = { verified: "Verified", partial: "Partially verified", unverified: "Unverified" };
export function VerifyBadge({ value }: { value: string }) {
  const tone = value === "verified" ? "success" : value === "partial" ? "info" : "neutral";
  const Icon = value === "verified" ? CheckCircle2 : value === "partial" ? CircleHelp : ShieldAlert;
  return (
    <Badge tone={tone}>
      <Icon className="size-3" aria-hidden />
      {VERIFY_LABEL[value] ?? value}
    </Badge>
  );
}

export function ScoreChip({ score }: { score: number }) {
  const tone = score >= 70 ? "text-success" : score >= 55 ? "text-accent" : score >= 40 ? "text-info" : "text-muted";
  return <span className={`tabular inline-block min-w-8 text-right text-sm font-semibold ${tone}`}>{score}</span>;
}

export const PHONE_LABEL: Record<string, string> = { valid_format: "Valid format", possible: "Possible", invalid: "Invalid", unverified: "Unverified" };
export const EMAIL_LABEL: Record<string, string> = { domain_verified: "Domain verified", valid_format: "Valid format", uncertain: "Deliverability uncertain", invalid: "Invalid", unverified: "Unverified" };

export function StatusDot({ status }: { status: string }) {
  const good = status === "valid_format" || status === "domain_verified" || status === "reachable";
  const bad = status === "invalid" || status === "unreachable";
  const Icon = good ? CheckCircle2 : bad ? XCircle : AlertTriangle;
  return <Icon className={`inline size-3.5 ${good ? "text-success" : bad ? "text-danger" : "text-muted"}`} aria-label={status} />;
}

export const CERTAINTY_LABEL: Record<string, { label: string; tone: "success" | "info" | "warn" | "neutral" }> = {
  verified: { label: "Verified", tone: "success" },
  detected: { label: "Detected", tone: "info" },
  needs_review: { label: "Needs review", tone: "warn" },
  not_detected: { label: "Not detected", tone: "neutral" },
};

export const SOURCE_LABEL: Record<string, string> = {
  osm: "OpenStreetMap",
  google_places: "Google Maps",
  website: "Website",
  user_import: "Imported",
};
export const sourceName = (s: string) => SOURCE_LABEL[s] ?? s;

export const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";
export const fmtDateTime = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

export function relTime(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return fmtDate(d);
}

export const countryName = (code?: string | null) => {
  if (!code) return "Unknown";
  try {
    return new Intl.DisplayNames(undefined, { type: "region" }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
};
