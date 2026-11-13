"use client";
import { Ban, Bookmark, BookmarkCheck, Download, ListChecks, Map as MapIcon, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { getNiche } from "@/lib/taxonomy/niches";
import { call, useApi } from "../hooks";
import { ClassBadge, ScoreChip, fmtDateTime, sourceName } from "../labels";
import { Badge, Bar, Button, Card, CardHeader, Empty, ErrorNote, PageHeader, Spinner } from "../ui";
import type { SearchStats } from "@/lib/search/config";

interface SearchRow { id: string; name: string; status: string; config: Record<string, unknown> & { nicheIds?: string[]; customNiches?: string[]; location?: { label: string }; radius?: { value: number; unit: string }; sources?: string[]; strategy?: string }; stats: SearchStats; error: string | null; saved: boolean; startedAt: string | null; finishedAt: string | null; createdAt: string }
interface Ev { id: string; level: "info" | "warn" | "error"; source: string | null; message: string; createdAt: string }

const PHASES = [
  { id: "discovering", label: "Discover" },
  { id: "filtering", label: "Filter" },
  { id: "deduplicating", label: "De-duplicate" },
  { id: "enriching", label: "Enrich & verify" },
  { id: "completed", label: "Done" },
];

export function SearchMonitor({ id }: { id: string }) {
  const router = useRouter();
  const [live, setLive] = useState(true);
  const { data, error, loading, reload } = useApi<{ search: SearchRow; events: Ev[]; leadCount: number }>(`/api/searches/${id}`, { refreshMs: live ? 1500 : undefined });
  const done = data ? !["queued", "running"].includes(data.search.status) : false;
  if (data && done && live) setLive(false);
  const top = useApi<{ rows: { id: string; name: string; city: string | null; score: number; classification: string; sourcePrimary: string }[]; total: number }>(done ? `/api/leads?searchId=${id}&pageSize=8&sort=score` : null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return null;
  const s = data.search;
  const st = s.stats;
  const phaseIdx = s.status === "completed" ? PHASES.length - 1 : Math.max(0, PHASES.findIndex((p) => p.id === st.phase));
  const niches = [...(s.config.nicheIds ?? []).map((n) => getNiche(n)?.name ?? n), ...(s.config.customNiches ?? [])];

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const statusTone = s.status === "completed" ? "success" : s.status === "failed" ? "danger" : s.status === "cancelled" ? "neutral" : "info";

  return (
    <div>
      <PageHeader
        title={s.name}
        description={<>{niches.slice(0, 4).join(", ")}{niches.length > 4 ? "…" : ""} · {s.config.location?.label} · {s.config.radius?.value} {s.config.radius?.unit} · {s.config.strategy}</>}
        actions={
          <>
            <Badge tone={statusTone}>{s.status}</Badge>
            {!done && <Button variant="danger" size="sm" loading={busy} onClick={() => act(async () => { await call(`/api/searches/${id}/cancel`, { method: "POST" }); await reload(); })}><Ban className="size-3.5" /> Cancel</Button>}
            {done && <Button size="sm" loading={busy} onClick={() => act(async () => { const r = await call<{ id: string }>(`/api/searches/${id}/rerun`, { method: "POST" }); router.push(`/searches/${r.id}`); })}><RotateCcw className="size-3.5" /> Re-run</Button>}
            <Button size="sm" onClick={() => act(async () => { await call(`/api/searches/${id}`, { method: "PATCH", body: { saved: !s.saved } }); await reload(); })}>
              {s.saved ? <BookmarkCheck className="size-3.5" /> : <Bookmark className="size-3.5" />} {s.saved ? "Saved" : "Save search"}
            </Button>
          </>
        }
      />
      {actionError && <div className="mb-3"><ErrorNote>{actionError}</ErrorNote></div>}
      {s.error && <div className="mb-3"><ErrorNote>{s.error}</ErrorNote></div>}

      <Card className="mb-4 p-4">
        <ol className="flex items-center gap-2" aria-label="Search phases">
          {PHASES.map((p, i) => (
            <li key={p.id} className="flex flex-1 flex-col gap-1.5">
              <Bar value={i < phaseIdx || (s.status === "completed") ? 1 : i === phaseIdx && !done ? 0.5 : 0} max={1} tone={s.status === "failed" && i === phaseIdx ? "warn" : "accent"} />
              <span className={`text-xs ${i === phaseIdx ? "font-medium text-ink" : "text-muted"}`}>{p.label}</span>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-muted">Phases reflect the job&apos;s actual state. {st.sourcesTotal > 0 && `${st.sourcesDone}/${st.sourcesTotal} sources finished discovery.`} Started {fmtDateTime(s.startedAt)}{s.finishedAt ? ` · finished ${fmtDateTime(s.finishedAt)}` : ""}</p>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Counter label="Businesses found" value={st.discovered} />
        <Counter label="Filtered out" value={st.filteredOut} />
        <Counter label="Duplicates merged" value={st.duplicatesMerged} />
        <Counter label="Possible dupes" value={st.uncertainDuplicates} hint="manual review" />
        <Counter label="New leads" value={st.newLeads} tone="success" />
        <Counter label="Existing updated" value={st.updatedExisting} />
        <Counter label="Websites checked" value={st.enriched} />
        <Counter label="Partly/fully verified" value={st.verified} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title="Activity log" hint="Real events from the job" />
          <div className="max-h-96 overflow-y-auto bg-surface-2/50 p-3 font-mono text-xs leading-relaxed" aria-live="polite">
            {data.events.length === 0 ? <p className="text-muted">Waiting for the job to start…</p> : data.events.map((e) => (
              <div key={e.id} className={e.level === "error" ? "text-danger" : e.level === "warn" ? "text-warn" : "text-ink"}>
                <span className="text-muted">{new Date(e.createdAt).toLocaleTimeString()}</span> {e.source && <span className="text-accent">[{sourceName(e.source)}]</span>} {e.message}
              </div>
            ))}
          </div>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Sources" />
            <ul className="divide-y divide-line">
              {Object.entries(st.bySource).length === 0 ? <li className="px-4 py-3 text-sm text-muted">No source activity yet.</li> : Object.entries(st.bySource).map(([k, v]) => (
                <li key={k} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span>{sourceName(k)}</span>
                  <span className="flex items-center gap-2"><span className="tabular text-muted">{v.found} found</span>{v.errors > 0 && <Badge tone="danger">{v.errors} failed</Badge>}</span>
                </li>
              ))}
            </ul>
            <div className="grid grid-cols-3 gap-2 border-t border-line px-4 py-3 text-xs">
              <div><p className="text-muted">Failed requests</p><p className="tabular text-sm font-semibold">{st.failedRequests}</p></div>
              <div><p className="text-muted">Rate-limit warnings</p><p className="tabular text-sm font-semibold">{st.rateLimitWarnings}</p></div>
              <div><p className="text-muted">Radius used</p><p className="tabular text-sm font-semibold">{st.radiusKmUsed ? `${st.radiusKmUsed} km` : "—"}{st.expansions ? ` (+${st.expansions})` : ""}</p></div>
            </div>
          </Card>
        </div>
      </div>

      {done && (
        <Card className="mt-4">
          <CardHeader
            title={`Results${top.data ? ` · ${top.data.total} leads` : ""}`}
            hint="Top leads by quality score from this search"
            action={
              <div className="flex gap-2">
                <Link href={`/leads?searchId=${id}`}><Button size="sm"><ListChecks className="size-3.5" /> Open in table</Button></Link>
                <Link href={`/map?searchId=${id}`}><Button size="sm"><MapIcon className="size-3.5" /> View on map</Button></Link>
                <Link href={`/leads?searchId=${id}&export=1`}><Button size="sm" variant="primary"><Download className="size-3.5" /> Export</Button></Link>
              </div>
            }
          />
          {!top.data ? <Spinner /> : top.data.rows.length === 0 ? (
            <Empty title="No leads were saved by this search">{s.status === "completed" ? "Everything found was filtered out or already in your workspace. Try the Maximum Coverage strategy, loosen filters or widen the radius." : "The search did not finish."}</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {top.data.rows.map((l) => (
                <li key={l.id}>
                  <Link href={`/leads?open=${l.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
                    <ScoreChip score={l.score} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{l.name}<span className="ml-2 font-normal text-muted">{l.city}</span></span>
                    <ClassBadge value={l.classification} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}

function Counter({ label, value, hint, tone }: { label: string; value: number; hint?: string; tone?: "success" }) {
  return (
    <Card className="px-3 py-2.5">
      <p className="truncate text-[11px] text-muted">{label}</p>
      <p className={`tabular text-xl font-semibold ${tone === "success" ? "text-success" : ""}`}>{value.toLocaleString()}</p>
      {hint && <p className="text-[10px] text-muted">{hint}</p>}
    </Card>
  );
}
