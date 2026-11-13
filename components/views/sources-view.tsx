"use client";
import { CheckCircle2, CircleDashed, KeyRound } from "lucide-react";
import { useApi } from "../hooks";
import { Badge, Card, ErrorNote, PageHeader, Spinner } from "../ui";

export interface Connector {
  id: string; name: string; kind: string; status: "live_tested" | "implemented_untested" | "planned"; summary: string; returns: string[]; cost: string; requiresKey: boolean; envVar?: string;
  limits: string; freshness: string; regions: string; compliance: string; docsUrl?: string; configured: boolean; setupMessage: string | null; usage30d: { requests: number; errors: number }; leads: number;
}

export function statusBadge(c: Connector) {
  if (c.status === "planned") return <Badge>Planned · not implemented</Badge>;
  if (!c.configured) return <Badge tone="warn"><KeyRound className="size-3" /> Needs API key</Badge>;
  if (c.status === "live_tested") return <Badge tone="success"><CheckCircle2 className="size-3" /> Live · tested</Badge>;
  return <Badge tone="info">Configured · not yet tested</Badge>;
}

export function SourcesView() {
  const { data, error, loading } = useApi<{ connectors: Connector[] }>("/api/sources");
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorNote>{error}</ErrorNote>;
  const groups = [
    { title: "Ready to use", items: data!.connectors.filter((c) => c.status !== "planned" && c.configured) },
    { title: "Implemented — needs configuration", items: data!.connectors.filter((c) => c.status !== "planned" && !c.configured) },
    { title: "Planned (not implemented)", items: data!.connectors.filter((c) => c.status === "planned") },
  ];
  return (
    <div>
      <PageHeader title="Data sources" description="What each source returns, what it costs, and whether it is genuinely operational. A source is only marked “live” after it has been implemented and tested against the real service." />
      {groups.map((g) => g.items.length > 0 && (
        <section key={g.title} className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-muted">{g.title}</h2>
          <div className="grid gap-3 lg:grid-cols-2">
            {g.items.map((c) => (
              <Card key={c.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div><p className="font-medium">{c.name}</p><p className="text-xs capitalize text-muted">{c.kind}</p></div>
                  {statusBadge(c)}
                </div>
                <p className="mt-2 text-[13px] text-muted">{c.summary}</p>
                {c.setupMessage && c.status !== "planned" && <p className="mt-2 rounded-md bg-warn-soft px-2.5 py-1.5 text-xs text-warn">{c.setupMessage}</p>}
                <dl className="mt-3 space-y-1.5 text-xs">
                  {c.returns.length > 0 && <Row k="Returns" v={c.returns.join(", ")} />}
                  <Row k="Cost" v={c.cost} />
                  {c.envVar && <Row k="API key" v={<code className="rounded bg-surface-2 px-1">{c.envVar}</code>} />}
                  {c.status !== "planned" && <><Row k="Limits" v={c.limits} /><Row k="Freshness" v={c.freshness} /><Row k="Coverage" v={c.regions} /></>}
                  <Row k="Compliance" v={c.compliance} />
                </dl>
                {c.status !== "planned" && (
                  <div className="mt-3 flex gap-5 border-t border-line pt-3 text-xs">
                    <span><span className="text-muted">Leads from this source:</span> <b className="tabular">{c.leads}</b></span>
                    <span><span className="text-muted">Requests (30 d):</span> <b className="tabular">{c.usage30d.requests}</b></span>
                    <span><span className="text-muted">Failed:</span> <b className="tabular">{c.usage30d.errors}</b></span>
                  </div>
                )}
                {c.status === "planned" && <p className="mt-2 flex items-center gap-1.5 text-xs text-muted"><CircleDashed className="size-3.5" /> Not available yet.</p>}
              </Card>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="grid grid-cols-[80px_1fr] gap-2"><dt className="text-muted">{k}</dt><dd>{v}</dd></div>;
}
