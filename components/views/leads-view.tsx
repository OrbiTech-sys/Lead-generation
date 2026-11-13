"use client";
import { ArrowDown, ArrowUp, Download, FolderPlus, Mail, Phone, Globe, Search, ShieldOff, Star, Tag, Trash2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { call, useApi } from "../hooks";
import { ExportDialog } from "../leads/export-dialog";
import { LeadDrawer, type Stage } from "../leads/lead-drawer";
import { CLASS_LABEL, ClassBadge, ScoreChip, StatusDot, VERIFY_LABEL, VerifyBadge, relTime, sourceName } from "../labels";
import { Badge, Button, Card, Empty, ErrorNote, Input, PageHeader, Select, Spinner } from "../ui";

interface LeadRow {
  id: string; name: string; subcategory: string | null; city: string | null; country: string | null; phone: string | null; phoneStatus: string; email: string | null; emailStatus: string;
  website: string | null; websiteStatus: string; rating: number | null; reviewCount: number | null; score: number; classification: string; verificationStatus: string; status: string;
  tags: string[]; sourcePrimary: string; sourceCount: number; opportunities: { key: string; label: string; certainty: string }[]; doNotContact: boolean; createdAt: string;
}
interface Page { rows: LeadRow[]; total: number; page: number; pageSize: number }

const FILTER_KEYS = ["q", "status", "classification", "verification", "source", "city", "hasEmail", "hasPhone", "hasWebsite", "opportunity", "minScore", "tag", "searchId", "listId"] as const;
type Filters = Partial<Record<(typeof FILTER_KEYS)[number], string>>;

const OPP_OPTIONS: [string, string][] = [
  ["no_website", "No website listed"], ["website_unreachable", "Website unreachable"], ["no_ssl", "No valid HTTPS"], ["slow_site", "Slow website"], ["mobile_unfriendly", "Possible poor mobile"],
  ["broken_links", "Broken links"], ["outdated_site", "Outdated website"], ["no_online_booking", "No online booking detected"], ["no_online_ordering", "No online ordering detected"],
  ["no_chatbot", "No chat widget detected"], ["no_contact_form", "No contact form detected"], ["no_crm_automation", "No CRM/automation detected"],
];

export function LeadsView() {
  const router = useRouter();
  const sp = useSearchParams();
  const [filters, setFilters] = useState<Filters>(() => Object.fromEntries(FILTER_KEYS.flatMap((k) => (sp.get(k) ? [[k, sp.get(k)!]] : []))));
  const [sort, setSort] = useState<{ by: string; dir: "asc" | "desc" }>({ by: "score", dir: "desc" });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(sp.get("open"));
  const [exportOpen, setExportOpen] = useState(sp.get("export") === "1");
  const [q, setQ] = useState(filters.q ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
    p.set("sort", sort.by);
    p.set("dir", sort.dir);
    p.set("page", String(page));
    p.set("pageSize", "50");
    return p.toString();
  }, [filters, sort, page]);
  const { data, error, loading, reload } = useApi<Page>(`/api/leads?${qs}`);
  const settings = useApi<{ stages: Stage[] }>("/api/settings");
  const team = useApi<{ members: { userId: string; name: string }[] }>("/api/team");
  const lists = useApi<{ lists: { id: string; name: string }[] }>("/api/lists");
  const stages = settings.data?.stages ?? [];
  const stageLabel = useCallback((k: string) => stages.find((s) => s.key === k)?.label ?? k, [stages]);

  useEffect(() => { const t = setTimeout(() => { setFilters((f) => ({ ...f, q: q || undefined })); setPage(1); }, 350); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setSelected(new Set()); }, [qs]);

  const setF = (k: keyof Filters, v: string) => { setFilters((f) => ({ ...f, [k]: v || undefined })); setPage(1); };
  const rows = data?.rows ?? [];
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const ids = [...selected];
  const activeFilters = Object.fromEntries(Object.entries(filters).filter(([, v]) => !!v)) as Record<string, string>;

  async function bulk(body: Record<string, unknown>, okText: string) {
    setMsg(null);
    try {
      await call("/api/leads", { method: "PATCH", body: { ids, ...body } });
      setMsg({ ok: true, text: okText });
      setSelected(new Set());
      await reload();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }
  async function del() {
    if (!confirm(`Permanently delete ${ids.length} lead(s)? This cannot be undone.`)) return;
    try {
      await call("/api/leads", { method: "DELETE", body: { ids } });
      setMsg({ ok: true, text: `Deleted ${ids.length} leads.` });
      setSelected(new Set());
      await reload();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }
  function head(label: string, by: string, className = "") {
    const active = sort.by === by;
    return (
      <th className={`px-3 py-2 text-left text-xs font-medium text-muted ${className}`} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
        <button className="inline-flex items-center gap-1 hover:text-ink" onClick={() => setSort({ by, dir: active && sort.dir === "desc" ? "asc" : "desc" })}>
          {label}{active && (sort.dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
        </button>
      </th>
    );
  }
  const clear = () => { setFilters({}); setQ(""); setPage(1); router.replace("/leads"); };
  const nFilters = Object.keys(activeFilters).length;

  return (
    <div>
      <PageHeader
        title="All leads"
        description={data ? `${data.total.toLocaleString()} lead${data.total === 1 ? "" : "s"}${nFilters ? " match your filters" : " in your workspace"}.` : undefined}
        actions={<Button variant="primary" onClick={() => setExportOpen(true)}><Download className="size-4" /> Export</Button>}
      />

      <Card className="mb-3 p-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <div className="relative sm:col-span-2">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, website, city, phone…" className="pl-8" aria-label="Search leads" />
          </div>
          <Select value={filters.status ?? ""} onChange={(e) => setF("status", e.target.value)} aria-label="Pipeline stage"><option value="">All stages</option>{stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</Select>
          <Select value={filters.classification ?? ""} onChange={(e) => setF("classification", e.target.value)} aria-label="Classification"><option value="">All classifications</option>{Object.entries(CLASS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          <Select value={filters.verification ?? ""} onChange={(e) => setF("verification", e.target.value)} aria-label="Verification"><option value="">Any verification</option>{Object.entries(VERIFY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          <Select value={filters.opportunity ?? ""} onChange={(e) => setF("opportunity", e.target.value)} aria-label="Opportunity"><option value="">Any opportunity</option>{OPP_OPTIONS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          <Select value={filters.source ?? ""} onChange={(e) => setF("source", e.target.value)} aria-label="Source"><option value="">Any source</option><option value="osm">OpenStreetMap</option><option value="google_places">Google Maps</option><option value="website">Website</option></Select>
          <Select value={filters.hasEmail ?? ""} onChange={(e) => setF("hasEmail", e.target.value)} aria-label="Email"><option value="">Email: any</option><option value="1">Has email</option><option value="0">No email</option></Select>
          <Select value={filters.hasPhone ?? ""} onChange={(e) => setF("hasPhone", e.target.value)} aria-label="Phone"><option value="">Phone: any</option><option value="1">Has phone</option><option value="0">No phone</option></Select>
          <Select value={filters.hasWebsite ?? ""} onChange={(e) => setF("hasWebsite", e.target.value)} aria-label="Website"><option value="">Website: any</option><option value="1">Has website</option><option value="0">No website</option></Select>
          <Input type="number" min={0} max={100} value={filters.minScore ?? ""} onChange={(e) => setF("minScore", e.target.value)} placeholder="Min score" aria-label="Minimum score" />
          <Input value={filters.city ?? ""} onChange={(e) => setF("city", e.target.value)} placeholder="City" aria-label="City" />
          <Input value={filters.tag ?? ""} onChange={(e) => setF("tag", e.target.value)} placeholder="Tag" aria-label="Tag" />
          <Select value={filters.listId ?? ""} onChange={(e) => setF("listId", e.target.value)} aria-label="List"><option value="">Any list</option>{(lists.data?.lists ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>
        </div>
        {(nFilters > 0 || filters.searchId) && (
          <div className="mt-2 flex items-center gap-2 text-xs text-muted">
            {filters.searchId && <Badge tone="accent">From one search</Badge>}
            <button className="text-accent hover:underline" onClick={clear}>Clear all filters</button>
          </div>
        )}
      </Card>

      {selected.size > 0 && (
        <Card className="mb-3 flex flex-wrap items-center gap-2 border-accent/40 bg-accent-soft/40 px-3 py-2">
          <span className="text-[13px] font-medium">{selected.size} selected</span>
          <Select className="h-8 w-40 text-[13px]" value="" onChange={(e) => e.target.value && bulk({ set: { status: e.target.value } }, "Stage updated.")} aria-label="Set stage"><option value="">Set stage…</option>{stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</Select>
          <Select className="h-8 w-40 text-[13px]" value="" onChange={(e) => e.target.value && bulk({ addToList: e.target.value }, "Added to list.")} aria-label="Add to list"><option value="">Add to list…</option>{(lists.data?.lists ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>
          <Select className="h-8 w-40 text-[13px]" value="" onChange={(e) => e.target.value && bulk({ set: { assignedTo: e.target.value === "none" ? null : e.target.value } }, "Assigned.")} aria-label="Assign"><option value="">Assign to…</option><option value="none">Unassign</option>{(team.data?.members ?? []).map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</Select>
          <Button size="sm" onClick={() => { const t = prompt("Tag to add"); if (t?.trim()) void bulk({ addTags: [t.trim()] }, "Tag added."); }}><Tag className="size-3.5" /> Tag</Button>
          <Button size="sm" onClick={() => bulk({ set: { doNotContact: true } }, "Marked do-not-contact.")}><ShieldOff className="size-3.5" /> Do not contact</Button>
          <Button size="sm" onClick={() => setExportOpen(true)}><Download className="size-3.5" /> Export</Button>
          <Button size="sm" variant="danger" onClick={del}><Trash2 className="size-3.5" /> Delete</Button>
        </Card>
      )}
      {msg && <div className="mb-3">{msg.ok ? <p role="status" className="text-sm text-success">{msg.text}</p> : <ErrorNote>{msg.text}</ErrorNote>}</div>}

      <Card className="overflow-hidden">
        {loading && !data ? <Spinner /> : error ? <div className="p-4"><ErrorNote>{error}</ErrorNote></div> : rows.length === 0 ? (
          <Empty title={nFilters ? "No leads match these filters" : "No leads yet"} icon={<FolderPlus className="size-6" />}>
            {nFilters ? <button className="text-accent hover:underline" onClick={clear}>Clear filters</button> : "Run a search from Find Leads and your results will appear here."}
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-[13px]">
              <thead className="border-b border-line bg-surface-2/60">
                <tr>
                  <th className="w-10 px-3 py-2"><input type="checkbox" aria-label="Select all on page" checked={allOnPage} onChange={() => setSelected(allOnPage ? new Set() : new Set(rows.map((r) => r.id)))} className="size-4 accent-[var(--accent)]" /></th>
                  {head("Business", "name")}
                  {head("Score", "score", "w-20")}
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted">Classification</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted">Contact</th>
                  {head("Rating", "rating")}
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted">Opportunities</th>
                  {head("Stage", "status")}
                  {head("Found", "created")}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.id} className={`cursor-pointer hover:bg-surface-2/60 ${selected.has(r.id) ? "bg-accent-soft/40" : ""}`} onClick={() => setOpenId(r.id)}>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${r.name}`} checked={selected.has(r.id)} onChange={() => { const n = new Set(selected); n.has(r.id) ? n.delete(r.id) : n.add(r.id); setSelected(n); }} className="size-4 accent-[var(--accent)]" /></td>
                    <td className="max-w-64 px-3 py-2">
                      <p className="truncate font-medium">{r.name} {r.doNotContact && <ShieldOff className="inline size-3 text-danger" aria-label="Do not contact" />}</p>
                      <p className="truncate text-xs text-muted">{[r.subcategory, r.city].filter(Boolean).join(" · ")} · {sourceName(r.sourcePrimary)}{r.sourceCount > 1 ? ` +${r.sourceCount - 1}` : ""}</p>
                    </td>
                    <td className="px-3 py-2"><ScoreChip score={r.score} /></td>
                    <td className="px-3 py-2"><div className="flex flex-col items-start gap-1"><ClassBadge value={r.classification} /><VerifyBadge value={r.verificationStatus} /></div></td>
                    <td className="px-3 py-2">
                      <div className="flex gap-2.5 text-muted">
                        <span title={r.phone ?? "No phone"} className={r.phone ? "text-ink" : "opacity-30"}><Phone className="inline size-3.5" /> {r.phone && <StatusDot status={r.phoneStatus} />}</span>
                        <span title={r.email ?? "No email"} className={r.email ? "text-ink" : "opacity-30"}><Mail className="inline size-3.5" /> {r.email && <StatusDot status={r.emailStatus} />}</span>
                        <span title={r.website ?? "No website"} className={r.website ? "text-ink" : "opacity-30"}><Globe className="inline size-3.5" /> {r.website && <StatusDot status={r.websiteStatus} />}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2">{r.rating != null ? <span className="inline-flex items-center gap-1"><Star className="size-3 fill-current text-warn" />{r.rating.toFixed(1)}<span className="text-xs text-muted">({r.reviewCount ?? 0})</span></span> : <span className="text-xs text-muted">unrated</span>}</td>
                    <td className="max-w-52 px-3 py-2"><div className="flex flex-wrap gap-1">{r.opportunities.filter((o) => !["limited_presence", "incomplete_info"].includes(o.key)).slice(0, 2).map((o) => <Badge key={o.key} tone={o.certainty === "verified" ? "success" : o.certainty === "detected" ? "info" : "neutral"} title={`${o.label} (${o.certainty.replace("_", " ")})`}>{o.label}</Badge>)}</div></td>
                    <td className="px-3 py-2"><Badge tone="accent">{stageLabel(r.status)}</Badge></td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">{relTime(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > data.pageSize && (
          <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-[13px]">
            <span className="text-muted">Page {data.page} of {Math.ceil(data.total / data.pageSize)}</span>
            <div className="flex gap-2"><Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button size="sm" disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>Next</Button></div>
          </div>
        )}
      </Card>

      {openId && <LeadDrawer id={openId} stages={stages} members={team.data?.members ?? []} onClose={() => setOpenId(null)} onChanged={reload} />}
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} selectedIds={ids} filter={activeFilters} />
    </div>
  );
}
