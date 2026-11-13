"use client";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { call, useApi } from "../hooks";
import { Button, Card, CardHeader, ErrorNote, Field, Input, PageHeader, Select, Spinner } from "../ui";
import { fmtDate } from "../labels";

interface Settings {
  org: { id: string; name: string; plan: string; dailySearchQuota: number };
  weights: Record<string, number>; defaultWeights: Record<string, number>;
  stages: { key: string; label: string; color: string }[];
  suppressions: { id: string; type: string; value: string; reason: string | null; createdAt: string }[];
  role: string;
}
const W_LABEL: Record<string, string> = { contact: "Contact completeness", source: "Source reliability", relevance: "Business relevance", digital: "Digital opportunity", freshness: "Data freshness", activity: "Activity evidence" };

export function SettingsView() {
  const { data, error, loading, reload } = useApi<Settings>("/api/settings");
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [stages, setStages] = useState<Settings["stages"]>([]);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [sup, setSup] = useState({ type: "email", value: "", reason: "" });

  useEffect(() => {
    if (data) {
      setWeights(Object.fromEntries(Object.entries(data.weights).map(([k, v]) => [k, Math.round(v)])));
      setStages(data.stages);
      setName(data.org.name);
    }
  }, [data]);

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorNote>{error}</ErrorNote>;
  const d = data!;
  const admin = d.role === "owner" || d.role === "admin";
  const total = Object.values(weights).reduce((a, b) => a + b, 0);

  async function run(fn: () => Promise<string | void>) {
    setMsg(null);
    try { const t = await fn(); setMsg({ ok: true, text: t || "Saved." }); await reload(); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  }
  const move = (i: number, dir: -1 | 1) => { const s = [...stages]; const j = i + dir; if (j < 0 || j >= s.length) return; [s[i], s[j]] = [s[j], s[i]]; setStages(s); };

  return (
    <div>
      <PageHeader title="Settings" description={admin ? "Workspace configuration." : "Read-only — ask an admin to change settings."} />
      {msg && <div className="mb-3">{msg.ok ? <p role="status" className="text-sm text-success">{msg.text}</p> : <ErrorNote>{msg.text}</ErrorNote>}</div>}
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card className="p-4">
          <p className="mb-3 text-sm font-semibold">Workspace</p>
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} disabled={!admin} maxLength={100} /></Field>
          <p className="mt-2 text-xs text-muted">Plan: {d.org.plan} · {d.org.dailySearchQuota} searches/day quota</p>
          {admin && <Button className="mt-3" size="sm" onClick={() => run(async () => { await call("/api/settings", { method: "PATCH", body: { name } }); })}>Save name</Button>}
        </Card>

        <Card className="p-4">
          <p className="text-sm font-semibold">Lead score weights</p>
          <p className="mb-3 mt-1 text-xs text-muted">Relative importance of each component. Values are normalised to 100 points. Saving re-scores every lead.</p>
          <div className="space-y-2.5">
            {Object.keys(W_LABEL).map((k) => (
              <div key={k} className="grid grid-cols-[minmax(0,1fr)_minmax(64px,120px)_32px] items-center gap-3 text-[13px]">
                <span>{W_LABEL[k]}</span>
                <input type="range" min={0} max={50} value={weights[k] ?? 0} disabled={!admin} onChange={(e) => setWeights({ ...weights, [k]: Number(e.target.value) })} className="accent-[var(--accent)]" aria-label={W_LABEL[k]} />
                <span className="tabular text-right">{total ? Math.round(((weights[k] ?? 0) / total) * 100) : 0}</span>
              </div>
            ))}
          </div>
          {admin && <div className="mt-3 flex gap-2"><Button size="sm" variant="primary" disabled={total <= 0} onClick={() => run(async () => { const r = await call<{ rescored: number }>("/api/settings", { method: "PATCH", body: { weights } }); return `Saved. Re-scored ${r.rescored} leads.`; })}>Save & re-score</Button><Button size="sm" variant="ghost" onClick={() => setWeights(d.defaultWeights)}>Reset defaults</Button></div>}
        </Card>

        <Card className="p-4">
          <p className="text-sm font-semibold">Pipeline stages</p>
          <p className="mb-3 mt-1 text-xs text-muted">Customise the CRM pipeline. Leads in a removed stage move to the first stage.</p>
          <ul className="space-y-1.5">
            {stages.map((s, i) => (
              <li key={s.key} className="flex flex-wrap items-center gap-2">
                <input type="color" value={s.color} disabled={!admin} onChange={(e) => setStages(stages.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))} className="size-8 rounded border border-line bg-transparent" aria-label={`${s.label} colour`} />
                <Input value={s.label} disabled={!admin} onChange={(e) => setStages(stages.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} maxLength={40} aria-label="Stage name" className="min-w-0 flex-1 basis-32" />
                {admin && <><Button size="sm" variant="ghost" onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp className="size-3.5" /></Button><Button size="sm" variant="ghost" onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown className="size-3.5" /></Button><Button size="sm" variant="ghost" disabled={stages.length <= 2} onClick={() => setStages(stages.filter((_, j) => j !== i))} aria-label="Remove stage"><Trash2 className="size-3.5" /></Button></>}
              </li>
            ))}
          </ul>
          {admin && <div className="mt-3 flex gap-2"><Button size="sm" onClick={() => setStages([...stages, { key: `stage_${Date.now().toString(36)}`, label: "New stage", color: "#64748b" }])}><Plus className="size-3.5" /> Add stage</Button><Button size="sm" variant="primary" onClick={() => run(async () => { await call("/api/settings", { method: "PATCH", body: { stages } }); })}>Save stages</Button></div>}
        </Card>

        <Card>
          <CardHeader title="Suppression list" hint="Contacts you must not contact. Matching leads are flagged do-not-contact and excluded from exports and outreach drafts." />
          <div className="space-y-3 p-4">
            <div className="flex flex-wrap items-end gap-2">
              <Select value={sup.type} onChange={(e) => setSup({ ...sup, type: e.target.value })} className="w-28" aria-label="Type"><option value="email">Email</option><option value="phone">Phone</option><option value="domain">Domain</option></Select>
              <Input value={sup.value} onChange={(e) => setSup({ ...sup, value: e.target.value })} placeholder={sup.type === "phone" ? "+14155550123" : sup.type === "domain" ? "example.com" : "name@example.com"} className="min-w-0 flex-1 basis-40" aria-label="Value" />
              <Input value={sup.reason} onChange={(e) => setSup({ ...sup, reason: e.target.value })} placeholder="Reason (optional)" className="min-w-0 flex-1 basis-32" aria-label="Reason" />
              <Button variant="primary" disabled={!sup.value.trim()} onClick={() => run(async () => { await call("/api/settings", { method: "POST", body: { ...sup, reason: sup.reason || undefined } }); setSup({ ...sup, value: "", reason: "" }); })}>Add</Button>
            </div>
            {d.suppressions.length === 0 ? <p className="text-xs text-muted">Nothing suppressed.</p> : (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {d.suppressions.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 px-3 py-2 text-[13px]"><span className="min-w-0 break-words"><span className="text-xs uppercase text-muted">{s.type}</span> {s.value}{s.reason && <span className="text-xs text-muted"> · {s.reason}</span>}<span className="text-xs text-muted"> · {fmtDate(s.createdAt)}</span></span>{admin && <Button size="sm" variant="ghost" onClick={() => run(async () => { await call("/api/settings", { method: "DELETE", body: { id: s.id } }); })}>Remove</Button>}</li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card className="p-4 lg:col-span-2">
          <p className="text-sm font-semibold">Data handling</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-muted">
            <li>Every lead keeps its source records (URL, ID, collection time) — see a lead&apos;s Sources tab.</li>
            <li>Deleting a lead (All Leads → select → Delete) removes it and its provenance and activity permanently.</li>
            <li>Automated retention windows are not implemented; delete data manually when your lawful basis ends.</li>
            <li>Public availability of a business contact doesn&apos;t by itself permit every kind of marketing. Check GDPR/PECR, CCPA, CAN-SPAM, CASL and TCPA for your target region and channel.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
