"use client";
import { Bookmark, GitCompare, RotateCcw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { call, useApi } from "../hooks";
import { relTime } from "../labels";
import { Badge, Button, Card, Empty, ErrorNote, PageHeader, Spinner, Tabs } from "../ui";

interface S { id: string; name: string; status: string; saved: boolean; createdAt: string; stats: { discovered?: number; newLeads?: number; updatedExisting?: number }; config: { location?: { label: string }; strategy?: string } }
interface Cmp { newInThis: { id: string; name: string; city: string | null }[]; missingFromThis: { id: string; name: string }[]; common: number; totals: { this: number; other: number } }

export function SavedSearchesView() {
  const router = useRouter();
  const [tab, setTab] = useState<"saved" | "all">("saved");
  const { data, error, loading, reload } = useApi<{ searches: S[] }>(`/api/searches${tab === "saved" ? "?saved=1" : ""}`, { refreshMs: 5000 });
  const [pick, setPick] = useState<string[]>([]);
  const [cmp, setCmp] = useState<Cmp | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setErr(null);
    try { await fn(); await reload(); } catch (e) { setErr((e as Error).message); }
  }
  async function compare() {
    setErr(null);
    try { setCmp(await call<Cmp>(`/api/searches/${pick[0]}/compare`, { method: "POST", body: { with: pick[1] } })); } catch (e) { setErr((e as Error).message); }
  }

  return (
    <div>
      <PageHeader
        title="Saved searches & history"
        description="Re-run any search to find newly discovered businesses. Existing leads are matched, not duplicated. Scheduled/recurring runs and new-lead notifications are not built yet."
        actions={pick.length === 2 ? <Button variant="primary" onClick={compare}><GitCompare className="size-4" /> Compare selected</Button> : undefined}
      />
      <Tabs tabs={[{ id: "saved", label: "Saved" }, { id: "all", label: "All history" }]} value={tab} onChange={(t) => { setTab(t); setPick([]); setCmp(null); }} />
      {err && <div className="mt-3"><ErrorNote>{err}</ErrorNote></div>}
      <Card className="mt-3 overflow-hidden">
        {loading && !data ? <Spinner /> : error ? <div className="p-4"><ErrorNote>{error}</ErrorNote></div> : data!.searches.length === 0 ? (
          <Empty title={tab === "saved" ? "No saved searches" : "No searches yet"} icon={<Bookmark className="size-6" />}>{tab === "saved" ? "Open a search and choose “Save search” to keep it here." : "Start from Find Leads."}</Empty>
        ) : (
          <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-[13px]">
            <thead className="border-b border-line bg-surface-2/60 text-left text-xs text-muted"><tr><th className="w-10 px-3 py-2" /><th className="px-3 py-2">Search</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Found</th><th className="px-3 py-2">New</th><th className="px-3 py-2">When</th><th className="px-3 py-2" /></tr></thead>
            <tbody className="divide-y divide-line">
              {data!.searches.map((s) => (
                <tr key={s.id} className="hover:bg-surface-2/60">
                  <td className="px-3 py-2"><input type="checkbox" aria-label={`Select ${s.name} to compare`} checked={pick.includes(s.id)} onChange={() => setPick(pick.includes(s.id) ? pick.filter((x) => x !== s.id) : [...pick.slice(-1), s.id])} className="size-4 accent-[var(--accent)]" /></td>
                  <td className="px-3 py-2"><Link href={`/searches/${s.id}`} className="font-medium hover:text-accent">{s.name}</Link><p className="text-xs text-muted">{s.config.location?.label} · {s.config.strategy}</p></td>
                  <td className="px-3 py-2"><Badge tone={s.status === "completed" ? "success" : s.status === "failed" ? "danger" : s.status === "cancelled" ? "neutral" : "info"}>{s.status}</Badge></td>
                  <td className="tabular px-3 py-2">{s.stats.discovered ?? 0}</td>
                  <td className="tabular px-3 py-2">{s.stats.newLeads ?? 0}{s.stats.updatedExisting ? <span className="text-xs text-muted"> (+{s.stats.updatedExisting} existing)</span> : null}</td>
                  <td className="px-3 py-2 text-muted">{relTime(s.createdAt)}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => run(async () => { const r = await call<{ id: string }>(`/api/searches/${s.id}/rerun`, { method: "POST" }); router.push(`/searches/${r.id}`); })}><RotateCcw className="size-3.5" /> Re-run</Button>
                      <Button size="sm" variant="ghost" onClick={() => run(() => call(`/api/searches/${s.id}`, { method: "PATCH", body: { saved: !s.saved } }))}><Bookmark className={`size-3.5 ${s.saved ? "fill-current" : ""}`} /></Button>
                      <Button size="sm" variant="ghost" onClick={() => confirm("Delete this search record? Its leads are kept.") && run(() => call(`/api/searches/${s.id}`, { method: "DELETE" }))} aria-label="Delete"><Trash2 className="size-3.5" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Card>
      {cmp && (
        <Card className="mt-4 p-4">
          <p className="mb-2 text-sm font-semibold">Comparison</p>
          <p className="text-[13px] text-muted">First selected: {cmp.totals.this} businesses · second: {cmp.totals.other} · in both: {cmp.common}</p>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <div><p className="mb-1 text-[13px] font-medium">Only in first ({cmp.newInThis.length})</p><ul className="max-h-48 space-y-0.5 overflow-y-auto text-[13px]">{cmp.newInThis.map((l) => <li key={l.id}><Link className="hover:text-accent" href={`/leads?open=${l.id}`}>{l.name}</Link> <span className="text-muted">{l.city}</span></li>)}{cmp.newInThis.length === 0 && <li className="text-muted">None</li>}</ul></div>
            <div><p className="mb-1 text-[13px] font-medium">Only in second ({cmp.missingFromThis.length})</p><ul className="max-h-48 space-y-0.5 overflow-y-auto text-[13px]">{cmp.missingFromThis.map((l) => <li key={l.id}><Link className="hover:text-accent" href={`/leads?open=${l.id}`}>{l.name}</Link></li>)}{cmp.missingFromThis.length === 0 && <li className="text-muted">None</li>}</ul></div>
          </div>
        </Card>
      )}
    </div>
  );
}
