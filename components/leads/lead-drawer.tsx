"use client";
import { ExternalLink, Globe, Mail, MapPin, Phone, RefreshCw, ShieldOff, X } from "lucide-react";
import { useState } from "react";
import type { WebsiteAudit } from "@/lib/enrich/website-audit";
import type { Opportunity, ScoreResult } from "@/lib/scoring/types";
import { call, useApi } from "../hooks";
import { CERTAINTY_LABEL, ClassBadge, EMAIL_LABEL, PHONE_LABEL, ScoreChip, StatusDot, VerifyBadge, countryName, fmtDateTime, relTime, sourceName } from "../labels";
import { Badge, Bar, Button, Card, ErrorNote, Field, Input, Select, Spinner, Tabs, Textarea } from "../ui";

export interface Stage { key: string; label: string; color: string }
interface Member { userId: string; name: string }

interface LeadDetail {
  lead: {
    id: string; name: string; industry: string | null; subcategory: string | null; country: string | null; state: string | null; city: string | null; address: string | null; postcode: string | null;
    phone: string | null; phoneE164: string | null; phoneType: string | null; phoneStatus: string; email: string | null; emailStatus: string; emailSourceUrl: string | null;
    website: string | null; websiteStatus: string; mapsUrl: string | null; rating: number | null; reviewCount: number | null; facebook: string | null; instagram: string | null; linkedin: string | null;
    description: string | null; contactPerson: string | null; contactPosition: string | null; openingHours: string | null; businessStatus: string | null;
    status: string; tags: string[]; assignedTo: string | null; followUpAt: string | null; doNotContact: boolean; score: number; scoreBreakdown: ScoreResult | null; classification: string;
    verificationStatus: string; opportunities: Opportunity[]; websiteAudit: WebsiteAudit | null; lastVerifiedAt: string | null; createdAt: string; sourceCount: number;
  };
  sources: { id: string; source: string; sourceUrl: string | null; sourceRecordId: string; collectedAt: string }[];
  activities: { id: string; type: string; body: string | null; outcome: string | null; followUpAt: string | null; createdAt: string; userName: string | null }[];
  lists: { id: string; name: string }[];
}

type TabId = "overview" | "opportunities" | "score" | "sources" | "activity" | "outreach";

export function LeadDrawer({ id, stages, members, onClose, onChanged }: { id: string; stages: Stage[]; members: Member[]; onClose: () => void; onChanged: () => void }) {
  const { data, error, loading, reload } = useApi<LeadDetail>(`/api/leads/${id}`);
  const [tab, setTab] = useState<TabId>("overview");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>) {
    setErr(null);
    try {
      await call(`/api/leads/${id}`, { method: "PATCH", body });
      await reload();
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  async function reverify() {
    setBusy(true);
    setErr(null);
    try {
      await call(`/api/leads/${id}/reverify`, { method: "POST" });
      await reload();
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const l = data?.lead;
  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label="Lead details">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-2xl flex-col border-l border-line bg-bg shadow-2xl">
        <div className="flex items-start gap-3 border-b border-line bg-surface px-5 py-4">
          <div className="min-w-0 flex-1">
            {l ? (
              <>
                <h2 className="truncate text-lg font-semibold">{l.name}</h2>
                <p className="mt-0.5 text-[13px] text-muted">{[l.subcategory, l.city, countryName(l.country)].filter(Boolean).join(" · ")}</p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <ClassBadge value={l.classification} />
                  <VerifyBadge value={l.verificationStatus} />
                  {l.doNotContact && <Badge tone="danger"><ShieldOff className="size-3" /> Do not contact</Badge>}
                </div>
              </>
            ) : <p className="text-sm text-muted">Loading…</p>}
          </div>
          {l && <div className="text-right"><p className="text-[11px] text-muted">Quality score</p><p className="tabular text-2xl font-semibold"><ScoreChip score={l.score} /></p></div>}
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-muted hover:bg-surface-2"><X className="size-5" /></button>
        </div>

        {loading && !data ? <Spinner /> : error ? <div className="p-5"><ErrorNote>{error}</ErrorNote></div> : l && data && (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-5 py-2.5">
              <Select value={l.status} onChange={(e) => patch({ status: e.target.value })} className="h-8 w-44 text-[13px]" aria-label="Pipeline stage">
                {stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                {!stages.some((s) => s.key === l.status) && <option value={l.status}>{l.status}</option>}
              </Select>
              <Select value={l.assignedTo ?? ""} onChange={(e) => patch({ assignedTo: e.target.value || null })} className="h-8 w-40 text-[13px]" aria-label="Assignee">
                <option value="">Unassigned</option>
                {members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
              </Select>
              <Button size="sm" onClick={reverify} loading={busy}><RefreshCw className="size-3.5" /> Re-verify</Button>
              <Button size="sm" variant={l.doNotContact ? "secondary" : "ghost"} onClick={() => patch({ doNotContact: !l.doNotContact })}>
                <ShieldOff className="size-3.5" /> {l.doNotContact ? "Allow contact" : "Mark do-not-contact"}
              </Button>
            </div>
            {err && <div className="px-5 pt-3"><ErrorNote>{err}</ErrorNote></div>}
            <div className="px-5 pt-2">
              <Tabs<TabId>
                value={tab} onChange={setTab}
                tabs={[
                  { id: "overview", label: "Overview" },
                  { id: "opportunities", label: "Opportunities", count: l.opportunities.length },
                  { id: "score", label: "Score" },
                  { id: "sources", label: "Sources", count: data.sources.length },
                  { id: "activity", label: "Activity", count: data.activities.length },
                  { id: "outreach", label: "Outreach" },
                ]}
              />
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {tab === "overview" && <Overview d={data} onPatch={patch} />}
              {tab === "opportunities" && <Opportunities l={l} />}
              {tab === "score" && <Score l={l} />}
              {tab === "sources" && <Sources d={data} />}
              {tab === "activity" && <Activity id={id} d={data} reload={async () => { await reload(); onChanged(); }} />}
              {tab === "outreach" && <Outreach id={id} blocked={l.doNotContact} />}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[130px_1fr] gap-2 py-1.5 text-[13px]">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children || <span className="text-muted">—</span>}</dd>
    </div>
  );
}

function Overview({ d, onPatch }: { d: LeadDetail; onPatch: (b: Record<string, unknown>) => void }) {
  const l = d.lead;
  const [tag, setTag] = useState("");
  const link = (href: string | null, text?: string) => href ? <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-accent hover:underline">{text ?? href.replace(/^https?:\/\/(www\.)?/, "")}<ExternalLink className="size-3" /></a> : null;
  return (
    <div className="space-y-4">
      <Card className="px-4 py-2">
        <dl className="divide-y divide-line">
          <KV label="Phone">
            {l.phone && <span className="inline-flex items-center gap-2"><Phone className="size-3.5 text-muted" /><a href={`tel:${l.phoneE164 ?? l.phone}`} className="hover:underline">{l.phone}</a><StatusDot status={l.phoneStatus} /><span className="text-xs text-muted">{PHONE_LABEL[l.phoneStatus]}{l.phoneType ? ` · ${l.phoneType.replace(/_/g, " ").toLowerCase()}` : ""}</span></span>}
          </KV>
          <KV label="Email">
            {l.email && <span className="inline-flex flex-wrap items-center gap-2"><Mail className="size-3.5 text-muted" /><a href={`mailto:${l.email}`} className="hover:underline">{l.email}</a><StatusDot status={l.emailStatus} /><span className="text-xs text-muted">{EMAIL_LABEL[l.emailStatus]}</span>{l.emailSourceUrl && <span className="text-xs text-muted">· published at {link(l.emailSourceUrl, "source")}</span>}</span>}
          </KV>
          <KV label="Website">{l.website && <span className="inline-flex items-center gap-2"><Globe className="size-3.5 text-muted" />{link(l.website)}<span className="text-xs text-muted">{l.websiteStatus}</span></span>}</KV>
          <KV label="Address">{l.address && <span className="inline-flex items-start gap-2"><MapPin className="mt-0.5 size-3.5 shrink-0 text-muted" />{l.address}</span>}</KV>
          <KV label="Maps listing">{link(l.mapsUrl, "Open in Google Maps")}</KV>
          <KV label="Rating">{l.rating != null && `${l.rating.toFixed(1)} ★  (${l.reviewCount ?? 0} reviews)`}</KV>
          <KV label="Hours">{l.openingHours}</KV>
          <KV label="Social">{[link(l.facebook, "Facebook"), link(l.instagram, "Instagram"), link(l.linkedin, "LinkedIn")].filter(Boolean).map((x, i) => <span key={i} className="mr-3">{x}</span>)}</KV>
          <KV label="Description">{l.description}</KV>
          <KV label="Contact person">{l.contactPerson ? `${l.contactPerson}${l.contactPosition ? `, ${l.contactPosition}` : ""}` : null}</KV>
          <KV label="Last verified">{l.lastVerifiedAt ? `${fmtDateTime(l.lastVerifiedAt)} (${relTime(l.lastVerifiedAt)})` : "Never"}</KV>
          <KV label="Discovered">{fmtDateTime(l.createdAt)}</KV>
        </dl>
      </Card>
      <Card className="p-4">
        <p className="mb-2 text-[13px] font-medium">Tags & follow-up</p>
        <div className="flex flex-wrap gap-1.5">
          {l.tags.map((t) => <Badge key={t} tone="accent" className="gap-1">{t}<button aria-label={`Remove ${t}`} onClick={() => onPatch({ tags: l.tags.filter((x) => x !== t) })}><X className="size-3" /></button></Badge>)}
          <form onSubmit={(e) => { e.preventDefault(); const t = tag.trim(); if (t && !l.tags.includes(t)) onPatch({ tags: [...l.tags, t] }); setTag(""); }}>
            <Input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Add tag…" className="h-7 w-28 text-xs" maxLength={40} aria-label="Add tag" />
          </form>
        </div>
        <div className="mt-3 flex items-end gap-3">
          <Field label="Follow-up date" className="w-52">
            <Input type="date" value={l.followUpAt ? l.followUpAt.slice(0, 10) : ""} onChange={(e) => onPatch({ followUpAt: e.target.value ? new Date(e.target.value + "T09:00:00").toISOString() : null })} />
          </Field>
          {d.lists.length > 0 && <p className="pb-2 text-xs text-muted">In lists: {d.lists.map((x) => x.name).join(", ")}</p>}
        </div>
      </Card>
      <Card className="p-4">
        <p className="mb-2 text-[13px] font-medium">Public business contact</p>
        <ContactPerson l={l} onPatch={onPatch} />
        <p className="mt-2 text-xs text-muted">Record only people who publish their contact details for business purposes.</p>
      </Card>
    </div>
  );
}

function ContactPerson({ l, onPatch }: { l: LeadDetail["lead"]; onPatch: (b: Record<string, unknown>) => void }) {
  const [name, setName] = useState(l.contactPerson ?? "");
  const [pos, setPos] = useState(l.contactPosition ?? "");
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="Name" className="flex-1"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></Field>
      <Field label="Position" className="flex-1"><Input value={pos} onChange={(e) => setPos(e.target.value)} maxLength={120} /></Field>
      <Button size="sm" onClick={() => onPatch({ contactPerson: name.trim() || null, contactPosition: pos.trim() || null })}>Save</Button>
    </div>
  );
}

function Opportunities({ l }: { l: LeadDetail["lead"] }) {
  const a = l.websiteAudit;
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">Rule-based findings. <b>Verified</b>/<b>detected</b> are observed evidence; <b>not detected</b> only means a check didn&apos;t see it (it may exist elsewhere); <b>needs review</b> requires a human look.</p>
      {l.opportunities.length === 0 ? <p className="text-sm text-muted">No digital gaps identified.</p> : l.opportunities.map((o) => (
        <Card key={o.key} className="p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[13px] font-medium">{o.label}</p>
            <Badge tone={CERTAINTY_LABEL[o.certainty].tone}>{CERTAINTY_LABEL[o.certainty].label}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted">{o.detail}</p>
          <p className="mt-1.5 text-xs"><span className="text-muted">Possible service:</span> {o.service}</p>
        </Card>
      ))}
      {a && (
        <Card className="p-3">
          <p className="mb-2 text-[13px] font-medium">Website audit <span className="text-xs font-normal text-muted">· {fmtDateTime(a.checkedAt)}</span></p>
          <dl className="grid grid-cols-2 gap-x-4 text-xs">
            <KV label="Reachable">{a.reachable === "detected" ? `Yes (HTTP ${a.httpStatus})` : a.error ?? "Unknown"}</KV>
            <KV label="HTTPS">{a.https === "detected" ? "Valid" : a.https === "verified_absent" ? a.httpsNote ?? "Not available" : "Unknown"}</KV>
            <KV label="Response time">{a.responseMs ? `${a.responseMs} ms` : null}</KV>
            <KV label="Page size">{a.pageKb ? `${a.pageKb} KB` : null}</KV>
            <KV label="Mobile viewport">{a.signals.viewport.replace("_", " ")}</KV>
            <KV label="Contact form">{a.signals.contactForm.replace("_", " ")}</KV>
            <KV label="Booking">{a.signals.booking.replace("_", " ")}</KV>
            <KV label="Online ordering">{a.signals.onlineOrdering.replace("_", " ")}</KV>
            <KV label="Chat widget">{a.signals.chat.replace("_", " ")}</KV>
            <KV label="CRM / marketing">{a.signals.crmOrMarketing.replace("_", " ")}</KV>
            <KV label="Broken links">{a.brokenLinks.checked ? `${a.brokenLinks.broken.length} of ${a.brokenLinks.checked} sampled` : null}</KV>
            <KV label="Copyright year">{a.signals.copyrightYear}</KV>
          </dl>
          {a.notes.map((n, i) => <p key={i} className="mt-1 text-xs text-muted">{n}</p>)}
        </Card>
      )}
    </div>
  );
}

function Score({ l }: { l: LeadDetail["lead"] }) {
  const s = l.scoreBreakdown;
  if (!s) return <p className="text-sm text-muted">No score breakdown stored.</p>;
  return (
    <div className="space-y-3">
      {s.components.map((c) => (
        <Card key={c.key} className="p-3">
          <div className="mb-1.5 flex items-center justify-between text-[13px]"><span className="font-medium">{c.label}</span><span className="tabular">{c.points} / {c.max}</span></div>
          <Bar value={c.points} max={c.max} tone="accent" />
          <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-muted">{c.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </Card>
      ))}
      <p className="text-xs text-muted">{s.note} Weights are configurable in Settings.</p>
    </div>
  );
}

function Sources({ d }: { d: LeadDetail }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">Every source record that contributed to this lead is preserved.</p>
      {d.sources.map((s) => (
        <Card key={s.id} className="flex items-center justify-between gap-3 p-3">
          <div className="min-w-0">
            <p className="text-[13px] font-medium">{sourceName(s.source)}</p>
            <p className="truncate text-xs text-muted">{s.sourceRecordId} · collected {fmtDateTime(s.collectedAt)}</p>
          </div>
          {s.sourceUrl && <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">Open <ExternalLink className="size-3" /></a>}
        </Card>
      ))}
    </div>
  );
}

const OUTCOMES = ["", "No answer", "Left voicemail", "Spoke — interested", "Spoke — not interested", "Wrong number", "Asked to call back", "Requested no further contact"];

function Activity({ id, d, reload }: { id: string; d: LeadDetail; reload: () => Promise<void> }) {
  const [type, setType] = useState("note");
  const [body, setBody] = useState("");
  const [outcome, setOutcome] = useState("");
  const [follow, setFollow] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function add() {
    setBusy(true);
    setErr(null);
    try {
      await call(`/api/leads/${id}/activities`, { method: "POST", body: { type, body: body || undefined, outcome: outcome || undefined, followUpAt: follow ? new Date(follow + "T09:00:00").toISOString() : undefined } });
      setBody(""); setOutcome(""); setFollow("");
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      <Card className="space-y-2.5 p-3">
        {err && <ErrorNote>{err}</ErrorNote>}
        <div className="flex flex-wrap gap-2">
          <Select value={type} onChange={(e) => setType(e.target.value)} className="h-8 w-32 text-[13px]" aria-label="Activity type">
            {["note", "call", "email", "sms", "meeting"].map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
          </Select>
          {type !== "note" && <Select value={outcome} onChange={(e) => setOutcome(e.target.value)} className="h-8 w-52 text-[13px]" aria-label="Outcome">{OUTCOMES.map((o) => <option key={o} value={o}>{o || "Outcome…"}</option>)}</Select>}
          <Input type="date" value={follow} onChange={(e) => setFollow(e.target.value)} className="h-8 w-40 text-[13px]" aria-label="Follow-up date" />
        </div>
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="Notes…" maxLength={5000} />
        <div className="flex justify-end"><Button variant="primary" size="sm" onClick={add} loading={busy} disabled={!body && !outcome && type === "note"}>Log activity</Button></div>
      </Card>
      <ol className="space-y-2">
        {d.activities.length === 0 && <p className="text-sm text-muted">No activity yet.</p>}
        {d.activities.map((a) => (
          <li key={a.id} className="rounded-lg border border-line bg-surface p-3">
            <div className="flex items-center justify-between text-xs text-muted"><span className="font-medium capitalize text-ink">{a.type.replace("_", " ")}{a.outcome ? ` · ${a.outcome}` : ""}</span><span>{a.userName ?? "System"} · {relTime(a.createdAt)}</span></div>
            {a.body && <p className="mt-1 whitespace-pre-wrap text-[13px]">{a.body}</p>}
            {a.followUpAt && <p className="mt-1 text-xs text-muted">Follow-up: {fmtDateTime(a.followUpAt)}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}

interface Draft { channel: string; subject?: string; body: string; basis: string[]; warnings: string[] }

function Outreach({ id, blocked }: { id: string; blocked: boolean }) {
  const [sender, setSender] = useState({ name: "", company: "The OrbiTech Solution", website: "https://theorbitechsolution.com", address: "" });
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function gen() {
    setBusy(true);
    setErr(null);
    try {
      const r = await call<{ drafts: Draft[] }>(`/api/leads/${id}/outreach`, { method: "POST", body: { sender: { ...sender, address: sender.address || undefined }, save: true } });
      setDrafts(r.drafts);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">Drafts are built from this lead&apos;s recorded findings and never invent facts. The platform doesn&apos;t send anything — review, edit and send yourself, subject to consent and local law (CAN-SPAM, GDPR/PECR, CASL, TCPA).</p>
      {blocked && <ErrorNote>This lead is marked do-not-contact. Outreach drafts are disabled.</ErrorNote>}
      <Card className="space-y-2 p-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Your name"><Input value={sender.name} onChange={(e) => setSender({ ...sender, name: e.target.value })} /></Field>
          <Field label="Company"><Input value={sender.company} onChange={(e) => setSender({ ...sender, company: e.target.value })} /></Field>
          <Field label="Website"><Input value={sender.website} onChange={(e) => setSender({ ...sender, website: e.target.value })} /></Field>
          <Field label="Postal address (required in commercial email)"><Input value={sender.address} onChange={(e) => setSender({ ...sender, address: e.target.value })} /></Field>
        </div>
        <Button variant="primary" size="sm" onClick={gen} loading={busy} disabled={!sender.name.trim() || !sender.company.trim() || blocked}>Generate drafts</Button>
        {err && <ErrorNote>{err}</ErrorNote>}
      </Card>
      {drafts?.map((d) => (
        <Card key={d.channel} className="p-3">
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-[13px] font-semibold capitalize">{d.channel === "call" ? "Cold-call opener" : d.channel}</p>
            <Button size="sm" variant="ghost" onClick={() => navigator.clipboard?.writeText((d.subject ? `Subject: ${d.subject}\n\n` : "") + d.body)}>Copy</Button>
          </div>
          {d.subject && <p className="mb-1 text-[13px]"><span className="text-muted">Subject:</span> {d.subject}</p>}
          <pre className="whitespace-pre-wrap rounded-lg bg-surface-2 p-3 font-sans text-[13px]">{d.body}</pre>
          <p className="mt-2 text-xs text-muted"><b>Based on:</b> {d.basis.join(" ")}</p>
          {d.warnings.map((w, i) => <p key={i} className="mt-1 text-xs text-warn">⚠ {w}</p>)}
        </Card>
      ))}
    </div>
  );
}
