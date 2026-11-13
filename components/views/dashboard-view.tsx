"use client";
import { ArrowRight, Search } from "lucide-react";
import Link from "next/link";
import { Bar as RBar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useApi } from "../hooks";
import { CLASS_LABEL, relTime, sourceName, countryName } from "../labels";
import { Badge, Button, Card, CardHeader, Empty, ErrorNote, PageHeader, Spinner, Stat } from "../ui";

interface Row { k: string; n: number }
interface Stats {
  totals: { total: number; verified: number; partial: number; highPriority: number; newThisWeek: number; avgScore: number; withEmail: number; withPhone: number; withWebsite: number };
  duplicatesPrevented: number; pendingReview: number; followUpsDue: number; sources: { available: number; total: number };
  byClass: Row[]; byNiche: Row[]; byCountry: Row[]; byCity: Row[]; bySource: Row[];
  searchActivity: { day: string; n: number }[];
  recentSearches: { id: string; name: string; status: string; createdAt: string; stats: { newLeads?: number; discovered?: number } }[];
}

const COLORS = ["#6366f1", "#14b8a6", "#f59e0b", "#ef4444", "#8b5cf6", "#0ea5e9", "#22c55e", "#ec4899"];
const CLASS_COLOR: Record<string, string> = { high_priority: "#22c55e", good_potential: "#6366f1", moderate_potential: "#0ea5e9", low_priority: "#94a3b8", needs_verification: "#f59e0b" };

export function DashboardView() {
  const { data, error, loading } = useApi<Stats>("/api/stats", { refreshMs: 15000 });
  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return null;
  const t = data.totals;
  const empty = t.total === 0;

  return (
    <div>
      <PageHeader
        title="Overview"
        description="Everything here is calculated from the leads and searches stored in your workspace."
        actions={<Link href="/find-leads"><Button variant="primary"><Search className="size-4" /> Find leads</Button></Link>}
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Stat label="Total leads" value={t.total.toLocaleString()} sub={`${t.newThisWeek} new in 7 days`} />
        <Stat label="Verified" value={t.verified.toLocaleString()} sub={`${t.partial} partially verified`} tone="success" />
        <Stat label="High priority" value={t.highPriority.toLocaleString()} sub={`avg score ${t.avgScore}`} tone="accent" />
        <Stat label="Duplicates prevented" value={data.duplicatesPrevented.toLocaleString()} sub={`${data.pendingReview} awaiting review`} />
        <Stat label="Sources ready" value={`${data.sources.available}/${data.sources.total}`} sub="configured discovery sources" />
        <Stat label="Follow-ups due" value={data.followUpsDue} sub="not converted / rejected" />
      </div>

      {empty ? (
        <Card className="mt-5">
          <Empty title="No leads yet">
            Run your first search to see real data here. OpenStreetMap discovery works without any API key.
            <div className="mt-3"><Link href="/find-leads"><Button variant="primary">Start a search <ArrowRight className="size-4" /></Button></Link></div>
          </Empty>
        </Card>
      ) : (
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader title="Lead quality distribution" hint="By classification" />
            <div className="h-56 px-2 py-2">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={data.byClass.map((r) => ({ name: CLASS_LABEL[r.k] ?? r.k, value: r.n, key: r.k }))} dataKey="value" innerRadius={50} outerRadius={80} paddingAngle={2}>
                    {data.byClass.map((r) => <Cell key={r.k} fill={CLASS_COLOR[r.k] ?? "#94a3b8"} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <Legend items={data.byClass.map((r) => ({ label: CLASS_LABEL[r.k] ?? r.k, n: r.n, color: CLASS_COLOR[r.k] ?? "#94a3b8" }))} />
          </Card>
          <BarCard title="Leads by niche" rows={data.byNiche} />
          <BarCard title="Leads by source" rows={data.bySource.map((r) => ({ k: sourceName(r.k), n: r.n }))} />
          <BarCard title="Leads by country" rows={data.byCountry.map((r) => ({ k: countryName(r.k === "Unknown" ? null : r.k), n: r.n }))} />
          <BarCard title="Leads by city" rows={data.byCity} />
          <Card>
            <CardHeader title="Search activity" hint="Searches started per day (14 days)" />
            <div className="h-56 px-2 py-3">
              {data.searchActivity.length === 0 ? <Empty title="No recent searches" /> : (
                <ResponsiveContainer>
                  <BarChart data={data.searchActivity}>
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} tick={{ fontSize: 11, fill: "var(--muted)" }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted)" }} width={28} />
                    <Tooltip />
                    <RBar dataKey="n" name="Searches" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>
        </div>
      )}

      <Card className="mt-4">
        <CardHeader title="Recent searches" action={<Link href="/saved-searches" className="text-xs text-accent hover:underline">View all</Link>} />
        {data.recentSearches.length === 0 ? <Empty title="No searches yet" /> : (
          <ul className="divide-y divide-line">
            {data.recentSearches.map((s) => (
              <li key={s.id}>
                <Link href={`/searches/${s.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-surface-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{s.name}</p>
                    <p className="text-xs text-muted">{relTime(s.createdAt)} · {s.stats.discovered ?? 0} found · {s.stats.newLeads ?? 0} new leads</p>
                  </div>
                  <Badge tone={s.status === "completed" ? "success" : s.status === "failed" ? "danger" : s.status === "cancelled" ? "neutral" : "info"}>{s.status}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Legend({ items }: { items: { label: string; n: number; color: string }[] }) {
  return (
    <ul className="space-y-1 px-4 pb-3">
      {items.map((i) => (
        <li key={i.label} className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-2"><span className="size-2 rounded-full" style={{ background: i.color }} />{i.label}</span>
          <span className="tabular text-muted">{i.n}</span>
        </li>
      ))}
    </ul>
  );
}

function BarCard({ title, rows }: { title: string; rows: Row[] }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <Card>
      <CardHeader title={title} hint="Top 10" />
      {rows.length === 0 ? <Empty title="No data yet" /> : (
        <ul className="space-y-2 px-4 py-3">
          {rows.map((r, i) => (
            <li key={r.k}>
              <div className="mb-0.5 flex justify-between text-xs"><span className="truncate pr-2">{r.k}</span><span className="tabular text-muted">{r.n}</span></div>
              <div className="h-1.5 rounded-full bg-surface-2"><div className="h-full rounded-full" style={{ width: `${(r.n / max) * 100}%`, background: COLORS[i % COLORS.length] }} /></div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
