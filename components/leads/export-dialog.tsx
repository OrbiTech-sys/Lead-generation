"use client";
import { Download } from "lucide-react";
import { useState } from "react";
import { download, useApi } from "../hooks";
import { Button, ErrorNote, Field, Modal, Select } from "../ui";

type Scope = "selected" | "filtered" | "high";

export function ExportDialog({ open, onClose, selectedIds, filter }: { open: boolean; onClose: () => void; selectedIds: string[]; filter: Record<string, string> }) {
  const cols = useApi<{ columns: { key: string; header: string }[] }>(open ? "/api/export" : null);
  const [format, setFormat] = useState<"csv" | "xlsx" | "xls" | "json">("xlsx");
  const [scope, setScope] = useState<Scope>(selectedIds.length ? "selected" : "filtered");
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const all = cols.data?.columns ?? [];
  const sel = chosen ?? all.map((c) => c.key);

  async function run() {
    setBusy(true);
    setErr(null);
    setNote(null);
    try {
      const body = {
        format,
        columns: sel.length === all.length ? undefined : sel,
        filter: scope === "high" ? { ...filter, classification: "high_priority" } : filter,
        ids: scope === "selected" ? selectedIds : undefined,
      };
      const res = await fetch("/api/export", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `Export failed (${res.status})`);
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `leads.${format}`;
      download(await res.blob(), name);
      const n = res.headers.get("x-export-count");
      const ex = Number(res.headers.get("x-export-excluded") ?? 0);
      setNote(`Exported ${n} leads.${ex ? ` ${ex} do-not-contact/suppressed leads were excluded.` : ""}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Export leads" wide footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button variant="primary" onClick={run} loading={busy}><Download className="size-4" /> Export</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Format">
            <Select value={format} onChange={(e) => setFormat(e.target.value as typeof format)}>
              <option value="xlsx">Excel (.xlsx)</option>
              <option value="csv">CSV (.csv)</option>
              <option value="xls">Excel-friendly CSV (UTF-8 with BOM)</option>
              <option value="json">JSON (.json)</option>
            </Select>
          </Field>
          <Field label="Which leads">
            <Select value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
              <option value="selected" disabled={!selectedIds.length}>Selected ({selectedIds.length})</option>
              <option value="filtered">All leads matching current filters</option>
              <option value="high">High-priority leads in current filters</option>
            </Select>
          </Field>
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between"><p className="text-[13px] font-medium">Columns</p><div className="flex gap-3 text-xs"><button className="text-accent hover:underline" onClick={() => setChosen(all.map((c) => c.key))}>All</button><button className="text-accent hover:underline" onClick={() => setChosen(["name", "city", "phone", "email", "website", "score"])}>Essentials</button></div></div>
          <div className="grid max-h-52 grid-cols-2 gap-x-3 overflow-y-auto rounded-lg border border-line p-2 sm:grid-cols-3">
            {all.map((c) => (
              <label key={c.key} className="flex items-center gap-2 rounded px-1.5 py-1 text-[13px] hover:bg-surface-2">
                <input type="checkbox" checked={sel.includes(c.key)} onChange={() => setChosen(sel.includes(c.key) ? sel.filter((k) => k !== c.key) : [...sel, c.key])} className="size-4 accent-[var(--accent)]" />
                <span className="truncate">{c.header}</span>
              </label>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted">Leads flagged do-not-contact or on your suppression lists are excluded, and suppressed emails/phones are blanked. Spreadsheet formula characters are neutralised. Phone numbers keep their international format and are stored as text in Excel.</p>
        {err && <ErrorNote>{err}</ErrorNote>}
        {note && <p role="status" className="text-sm text-success">{note}</p>}
      </div>
    </Modal>
  );
}
