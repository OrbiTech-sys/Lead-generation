"use client";
import { ChevronDown, ChevronRight, Plus, Save, Sparkles, X } from "lucide-react";
import { useMemo, useState } from "react";
import { ALL_NICHES, SUGGESTED_COMBINATIONS, TAXONOMY, getNiche } from "@/lib/taxonomy/niches";
import { call, useApi, useLocalState } from "../hooks";
import { Badge, Button, Card, Input } from "../ui";

export interface NicheState {
  nicheIds: string[];
  customNiches: string[];
  excludeKeywords: string[];
}

export function NichePicker({ value, onChange }: { value: NicheState; onChange: (v: NicheState) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [custom, setCustom] = useState("");
  const [excl, setExcl] = useState("");
  const [recent] = useLocalState<string[][]>("recentNicheSets", []);
  const saved = useApi<{ saved: { id: string; name: string; nicheIds: string[] }[] }>("/api/saved-niches");
  const sel = useMemo(() => new Set(value.nicheIds), [value.nicheIds]);
  const needle = q.trim().toLowerCase();

  const set = (ids: string[]) => onChange({ ...value, nicheIds: [...new Set(ids)] });
  const toggle = (id: string) => set(sel.has(id) ? value.nicheIds.filter((x) => x !== id) : [...value.nicheIds, id]);
  const total = value.nicheIds.length + value.customNiches.length;

  function applySet(ids: string[]) {
    onChange({ ...value, nicheIds: ids.filter((id) => getNiche(id)) });
  }
  async function saveCombo() {
    const name = prompt("Name this niche combination");
    if (!name?.trim() || !value.nicheIds.length) return;
    await call("/api/saved-niches", { method: "POST", body: { name: name.trim(), nicheIds: value.nicheIds } });
    saved.reload();
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <div className="border-b border-line p-3">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${ALL_NICHES.length} niches…  e.g. dental, roofing, yoga`} aria-label="Search niches" />
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {TAXONOMY.map((cat) => {
              const items = cat.niches.filter((n) => !needle || n.name.toLowerCase().includes(needle) || cat.name.toLowerCase().includes(needle));
              if (!items.length) return null;
              const expanded = needle ? true : !!open[cat.id];
              const nSel = cat.niches.filter((n) => sel.has(n.id)).length;
              const allSel = nSel === cat.niches.length;
              return (
                <div key={cat.id} className="border-b border-line last:border-0">
                  <div className="flex items-center gap-2 px-3 py-2">
                    <button onClick={() => setOpen({ ...open, [cat.id]: !expanded })} className="flex flex-1 items-center gap-1.5 text-left text-sm font-medium" aria-expanded={expanded}>
                      {expanded ? <ChevronDown className="size-4 text-muted" /> : <ChevronRight className="size-4 text-muted" />}
                      {cat.name}
                      <span className="text-xs font-normal text-muted">{nSel ? `${nSel}/` : ""}{cat.niches.length}</span>
                    </button>
                    <button
                      onClick={() => (allSel ? set(value.nicheIds.filter((id) => !cat.niches.some((n) => n.id === id))) : set([...value.nicheIds, ...cat.niches.map((n) => n.id)]))}
                      className="text-xs text-accent hover:underline"
                    >
                      {allSel ? "Clear all" : "Select all"}
                    </button>
                  </div>
                  {expanded && (
                    <ul className="grid gap-x-3 px-3 pb-2 sm:grid-cols-2">
                      {items.map((n) => (
                        <li key={n.id}>
                          <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-[13px] hover:bg-surface-2">
                            <input type="checkbox" checked={sel.has(n.id)} onChange={() => toggle(n.id)} className="size-4 accent-[var(--accent)]" />
                            <span className="truncate">{n.name}</span>
                            {n.osm.length === 0 && <span title="Matched by name keyword on OpenStreetMap (lower precision)" className="ml-auto text-[10px] text-muted">kw</span>}
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        <div className="space-y-3">
          <Card className="p-3">
            <p className="mb-2 text-[13px] font-medium">Selected ({total})</p>
            {total === 0 ? <p className="text-xs text-muted">Nothing selected yet. Pick from the list or add a custom niche.</p> : (
              <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                {value.nicheIds.map((id) => (
                  <Chip key={id} onRemove={() => toggle(id)}>{getNiche(id)?.name ?? id}</Chip>
                ))}
                {value.customNiches.map((c) => (
                  <Chip key={c} tone="accent" onRemove={() => onChange({ ...value, customNiches: value.customNiches.filter((x) => x !== c) })}>{c}</Chip>
                ))}
              </div>
            )}
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={saveCombo} disabled={!value.nicheIds.length}><Save className="size-3.5" /> Save combo</Button>
              {total > 0 && <Button size="sm" variant="ghost" onClick={() => onChange({ ...value, nicheIds: [], customNiches: [] })}>Clear</Button>}
            </div>
          </Card>

          <Card className="p-3">
            <p className="mb-1.5 text-[13px] font-medium">Custom niche</p>
            <form onSubmit={(e) => { e.preventDefault(); const c = custom.trim(); if (c.length >= 2 && !value.customNiches.includes(c)) onChange({ ...value, customNiches: [...value.customNiches, c] }); setCustom(""); }} className="flex gap-2">
              <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="e.g. drone repair" maxLength={80} aria-label="Custom niche" />
              <Button size="sm" type="submit"><Plus className="size-3.5" /></Button>
            </form>
            <p className="mt-1.5 text-xs text-muted">Custom niches are matched by business name, so precision is lower.</p>
          </Card>

          <Card className="p-3">
            <p className="mb-1.5 text-[13px] font-medium">Exclusion keywords</p>
            <form onSubmit={(e) => { e.preventDefault(); const c = excl.trim(); if (c && !value.excludeKeywords.includes(c)) onChange({ ...value, excludeKeywords: [...value.excludeKeywords, c] }); setExcl(""); }} className="flex gap-2">
              <Input value={excl} onChange={(e) => setExcl(e.target.value)} placeholder="e.g. franchise" maxLength={40} aria-label="Exclusion keyword" />
              <Button size="sm" type="submit"><Plus className="size-3.5" /></Button>
            </form>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {value.excludeKeywords.map((k) => <Chip key={k} tone="danger" onRemove={() => onChange({ ...value, excludeKeywords: value.excludeKeywords.filter((x) => x !== k) })}>{k}</Chip>)}
            </div>
            <p className="mt-1.5 text-xs text-muted">Businesses whose name contains these words are skipped.</p>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <ComboList title="Suggested combinations" icon={<Sparkles className="size-3.5" />} items={SUGGESTED_COMBINATIONS.map((c) => ({ key: c.name, label: c.name, hint: c.reason, ids: c.ids }))} onPick={applySet} />
        <ComboList title="Your saved combinations" items={(saved.data?.saved ?? []).map((s) => ({ key: s.id, label: s.name, hint: `${s.nicheIds.length} niches`, ids: s.nicheIds }))} onPick={applySet} empty="None saved yet." />
        <ComboList title="Recently searched" items={recent.map((ids, i) => ({ key: String(i), label: ids.map((id) => getNiche(id)?.name ?? id).slice(0, 2).join(", ") + (ids.length > 2 ? "…" : ""), hint: `${ids.length} niches`, ids }))} onPick={applySet} empty="Run a search and it appears here." />
      </div>
    </div>
  );
}

/** Called by the wizard when a search starts so the combination shows under "Recently searched". */
export function rememberNiches(ids: string[]) {
  if (!ids.length) return;
  try {
    const cur = JSON.parse(localStorage.getItem("recentNicheSets") ?? "[]") as string[][];
    const next = [ids, ...cur.filter((x) => x.join() !== ids.join())].slice(0, 6);
    localStorage.setItem("recentNicheSets", JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
}

function ComboList({ title, items, onPick, empty, icon }: { title: string; items: { key: string; label: string; hint: string; ids: string[] }[]; onPick: (ids: string[]) => void; empty?: string; icon?: React.ReactNode }) {
  return (
    <Card className="min-w-0 p-3">
      <p className="mb-2 flex items-center gap-1.5 text-[13px] font-medium">{icon}{title}</p>
      {items.length === 0 ? <p className="text-xs text-muted">{empty}</p> : (
        <ul className="space-y-1">
          {items.map((i) => (
            <li key={i.key}>
              <button onClick={() => onPick(i.ids)} className="w-full rounded-md px-2 py-1.5 text-left hover:bg-surface-2">
                <span className="block truncate text-[13px]">{i.label}</span>
                <span className="block truncate text-xs text-muted">{i.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Chip({ children, onRemove, tone = "neutral" }: { children: React.ReactNode; onRemove: () => void; tone?: "neutral" | "accent" | "danger" }) {
  return (
    <Badge tone={tone} className="gap-1 py-1">
      {children}
      <button onClick={onRemove} aria-label="Remove" className="rounded hover:bg-black/10"><X className="size-3" /></button>
    </Badge>
  );
}
