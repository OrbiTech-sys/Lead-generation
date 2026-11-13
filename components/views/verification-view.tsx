"use client";
import { GitMerge, Undo2, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { call, useApi } from "../hooks";
import { EMAIL_LABEL, PHONE_LABEL, VERIFY_LABEL, relTime } from "../labels";
import { Badge, Button, Card, CardHeader, Empty, ErrorNote, PageHeader, Spinner, Stat } from "../ui";

interface Brief { id: string; name: string; address: string | null; city: string | null; phone: string | null; email: string | null; website: string | null; score: number; sourceCount: number; sourcePrimary: string; lat: number | null; lng: number | null }
interface Cand { id: string; confidence: number; reasons: string[]; a: Brief; b: Brief }
interface Hist { id: string; mode: string; confidence: number | null; undone: boolean; createdAt: string; mergedName: string; survivorId: string }
interface Row { k: string; n: number }

export function VerificationView() {
  const v = useApi<{ candidates: Cand[]; history: Hist[] }>("/api/verification");
  const stats = useApi<{ totals: { total: number; verified: number; partial: number }; byVerification: Row[]; phoneStatus: Row[]; emailStatus: Row[]; byClass: Row[] }>("/api/stats");
  const [err, setErr] = useState<string | null>(null);

  async function act(body: Record<string, unknown>) {
    setErr(null);
    try {
      await call("/api/verification", { method: "POST", body });
      await Promise.all([v.reload(), stats.reload()]);
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  const total = stats.data?.totals.total ?? 0;
  const dist = (rows: Row[] | undefined, labels: Record<string, string>) => (rows ?? []).map((r) => ({ label: labels[r.k] ?? r.k, n: r.n }));

  return (
    <div>
      <PageHeader title="Verification center" description="A short list of reliable prospects beats a long list of questionable ones. Review data quality and resolve possible duplicates here." />
      {stats.data && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Verified" value={stats.data.totals.verified} sub="3+ independent checks passed" tone="success" />
          <Stat label="Partially verified" value={stats.data.totals.partial} sub="1–2 checks passed" />
          <Stat label="Unverified" value={Math.max(0, total - stats.data.totals.verified - stats.data.totals.partial)} sub="no checks passed" />
          <Stat label="Possible duplicates" value={v.data?.candidates.length ?? 0} sub="awaiting your decision" />
        </div>
      )}
      <div className="mb-4 grid gap-4 md:grid-cols-3">
        <Dist title="Phone status" rows={dist(stats.data?.phoneStatus, PHONE_LABEL)} total={total} note="“Valid format” does not mean the line is active." />
        <Dist title="Email status" rows={dist(stats.data?.emailStatus, EMAIL_LABEL)} total={total} note="Domain checks only — no mail is ever sent to verify." />
        <Dist title="Verification level" rows={dist(stats.data?.byVerification, VERIFY_LABEL)} total={total} note="Verified = ≥3 of: valid phone, verified email domain, reachable website, 2+ sources." />
      </div>

      {err && <div className="mb-3"><ErrorNote>{err}</ErrorNote></div>}
      <Card className="mb-4">
        <CardHeader title="Possible duplicates" hint="Auto-merge only happens for high-confidence matches. These pairs were uncertain, so nothing was merged." />
        {v.loading && !v.data ? <Spinner /> : !v.data?.candidates.length ? <Empty title="No duplicates waiting for review" /> : (
          <ul className="divide-y divide-line">
            {v.data.candidates.map((c) => (
              <li key={c.id} className="p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <Badge tone="warn">{Math.round(c.confidence * 100)}% match</Badge>
                  {c.reasons.map((r, i) => <span key={i}>{r}{i < c.reasons.length - 1 ? " ·" : ""}</span>)}
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {[c.a, c.b].map((l) => (
                    <div key={l.id} className="rounded-lg border border-line p-3 text-[13px]">
                      <div className="flex items-start justify-between gap-2"><Link href={`/leads?open=${l.id}`} className="font-medium hover:text-accent">{l.name}</Link><Badge>score {l.score}</Badge></div>
                      <p className="text-muted">{l.address ?? "No address"}</p>
                      <p className="text-muted">{[l.phone, l.email, l.website].filter(Boolean).join(" · ") || "No contact details"}</p>
                      <p className="mt-1 text-xs text-muted">{l.sourceCount} source(s)</p>
                      <Button size="sm" className="mt-2" onClick={() => act({ action: "merge", candidateId: c.id, survivorId: l.id })}><GitMerge className="size-3.5" /> Keep this one, merge the other</Button>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex justify-end"><Button size="sm" variant="ghost" onClick={() => act({ action: "reject", candidateId: c.id })}><X className="size-3.5" /> Not a duplicate</Button></div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Merge history" hint="Every merge keeps a snapshot, so it can be undone." />
        {!v.data?.history.length ? <Empty title="No merges yet" /> : (
          <ul className="divide-y divide-line">
            {v.data.history.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
                <div><p>Merged “{h.mergedName}” <Badge>{h.mode}</Badge>{h.undone && <Badge tone="neutral" className="ml-1">undone</Badge>}</p><p className="text-xs text-muted">{relTime(h.createdAt)}{h.confidence ? ` · ${Math.round(h.confidence * 100)}% confidence` : ""}</p></div>
                {!h.undone && <Button size="sm" onClick={() => act({ action: "undo", historyId: h.id })}><Undo2 className="size-3.5" /> Undo</Button>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="mt-3 text-xs text-muted">Need to check a single lead? Open it in <Link href="/leads?verification=unverified" className="text-accent hover:underline">All Leads → Unverified</Link> and use Re-verify.</p>
    </div>
  );
}

function Dist({ title, rows, total, note }: { title: string; rows: { label: string; n: number }[]; total: number; note: string }) {
  return (
    <Card>
      <CardHeader title={title} />
      <ul className="space-y-2 px-4 py-3">
        {rows.length === 0 ? <li className="text-sm text-muted">No data yet.</li> : rows.map((r) => (
          <li key={r.label}><div className="mb-0.5 flex justify-between text-xs"><span>{r.label}</span><span className="tabular text-muted">{r.n}</span></div><div className="h-1.5 rounded-full bg-surface-2"><div className="h-full rounded-full bg-accent" style={{ width: `${total ? (r.n / total) * 100 : 0}%` }} /></div></li>
        ))}
      </ul>
      <p className="border-t border-line px-4 py-2 text-xs text-muted">{note}</p>
    </Card>
  );
}
