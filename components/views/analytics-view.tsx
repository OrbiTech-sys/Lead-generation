"use client";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useApi } from "../hooks";
import { Card, CardHeader, Empty, ErrorNote, PageHeader, Spinner } from "../ui";

interface Row { k: string; n: number }
interface Stats {
  totals: { total: number; withEmail: number; withPhone: number; withWebsite: number; avgScore: number };
  byStatus: Row[]; scoreBuckets: { b: number; n: number }[]; opportunities: { key: string; label: string; n: number }[]; activity30: { day: string; n: number }[];
  apiUsage: { provider: string; day: string; requests: number; errors: number }[];
}

export function AnalyticsView() {
  const stats = useApi<Stats>("/api/stats");
  const settings = useApi<{ stages: { key: string; label: string }[] }>("/api/settings");
  if (stats.loading && !stats.data) return <Spinner />;
  if (stats.error) return <ErrorNote>{stats.error}</ErrorNote>;
  const d = stats.data!;
  if (d.totals.total === 0) return <div><PageHeader title="Analytics" /><Card><Empty title="Nothing to analyse yet">Analytics are computed from your stored leads and activity. Run a search first.</Empty></Card></div>;

  const stages = settings.data?.stages ?? [];
  const funnel = (stages.length ? stages : d.byStatus.map((s) => ({ key: s.k, label: s.k }))).map((s) => ({ label: s.label, n: d.byStatus.find((x) => x.k === s.key)?.n ?? 0 }));
  const hist = Array.from({ length: 10 }, (_, i) => ({ range: `${i * 10}–${i * 10 + 9}`, n: d.scoreBuckets.find((b) => b.b === i)?.n ?? 0 }));
  const usage = Object.values(d.apiUsage.reduce<Record<string, { provider: string; requests: number; errors: number }>>((a, u) => { (a[u.provider] ??= { provider: u.provider, requests: 0, errors: 0 }); a[u.provider].requests += u.requests; a[u.provider].errors += u.errors; return a; }, {}));
  const pct = (n: number) => `${Math.round((n / d.totals.total) * 100)}%`;
  const axis = { fontSize: 11, fill: "var(--muted)" };

  return (
    <div>
      <PageHeader title="Analytics" description="Computed from your stored leads, activity and API usage." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader title="Pipeline funnel" hint="Leads per stage" />
          <div className="h-64 px-2 py-3"><ResponsiveContainer><BarChart data={funnel} layout="vertical" margin={{ left: 20 }}><CartesianGrid horizontal={false} stroke="var(--border)" /><XAxis type="number" allowDecimals={false} tick={axis} /><YAxis type="category" dataKey="label" width={110} tick={axis} /><Tooltip /><Bar dataKey="n" name="Leads" fill="#6366f1" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></div>
        </Card>
        <Card><CardHeader title="Lead score distribution" hint="Quality score, not sale probability" />
          <div className="h-64 px-2 py-3"><ResponsiveContainer><BarChart data={hist}><CartesianGrid vertical={false} stroke="var(--border)" /><XAxis dataKey="range" tick={axis} /><YAxis allowDecimals={false} tick={axis} width={30} /><Tooltip /><Bar dataKey="n" name="Leads" fill="#14b8a6" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>
        </Card>
        <Card><CardHeader title="Most common digital opportunities" hint="Across all leads; certainty differs by type" />
          {d.opportunities.length === 0 ? <Empty title="No opportunities recorded" /> : <ul className="space-y-2 px-4 py-3">{d.opportunities.map((o) => <li key={o.key}><div className="mb-0.5 flex justify-between text-xs"><span>{o.label}</span><span className="tabular text-muted">{o.n} · {pct(o.n)}</span></div><div className="h-1.5 rounded-full bg-surface-2"><div className="h-full rounded-full bg-accent" style={{ width: pct(o.n) }} /></div></li>)}</ul>}
        </Card>
        <Card><CardHeader title="Data completeness" hint="Share of leads with each contact channel" />
          <ul className="space-y-2 px-4 py-3">{[["Phone", d.totals.withPhone], ["Email", d.totals.withEmail], ["Website", d.totals.withWebsite]].map(([k, n]) => <li key={k as string}><div className="mb-0.5 flex justify-between text-xs"><span>{k}</span><span className="tabular text-muted">{n} · {pct(n as number)}</span></div><div className="h-1.5 rounded-full bg-surface-2"><div className="h-full rounded-full bg-success" style={{ width: pct(n as number) }} /></div></li>)}</ul>
          <p className="border-t border-line px-4 py-2 text-xs text-muted">Average score: {d.totals.avgScore}/100</p>
        </Card>
        <Card><CardHeader title="Outreach activity" hint="Logged activities, last 30 days" />
          <div className="h-56 px-2 py-3">{d.activity30.length === 0 ? <Empty title="No activity logged yet" /> : <ResponsiveContainer><BarChart data={d.activity30}><CartesianGrid vertical={false} stroke="var(--border)" /><XAxis dataKey="day" tickFormatter={(x: string) => x.slice(5)} tick={axis} /><YAxis allowDecimals={false} tick={axis} width={28} /><Tooltip /><Bar dataKey="n" name="Activities" fill="#f59e0b" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>}</div>
        </Card>
        <Card><CardHeader title="API usage" hint="Requests made to external providers" />
          {usage.length === 0 ? <Empty title="No external requests recorded" /> : <div className="overflow-x-auto"><table className="w-full text-[13px]"><thead className="text-left text-xs text-muted"><tr><th className="px-4 py-2">Provider</th><th className="px-4 py-2">Requests</th><th className="px-4 py-2">Failed</th></tr></thead><tbody className="divide-y divide-line">{usage.map((u) => <tr key={u.provider}><td className="px-4 py-2">{u.provider}</td><td className="tabular px-4 py-2">{u.requests}</td><td className="tabular px-4 py-2">{u.errors}</td></tr>)}</tbody></table></div>}
        </Card>
      </div>
    </div>
  );
}
