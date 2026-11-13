"use client";
import { useApi } from "../hooks";
import { Badge, Card, ErrorNote, PageHeader, Spinner } from "../ui";
import { statusBadge, type Connector } from "./sources-view";

export function IntegrationsView() {
  const { data, error, loading } = useApi<{ connectors: Connector[] }>("/api/sources");
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorNote>{error}</ErrorNote>;
  const keyed = data!.connectors.filter((c) => c.envVar);
  return (
    <div>
      <PageHeader title="Integrations" description="API keys live in server environment variables and are never exposed to the browser. This page shows which are configured — not their values." />
      <Card className="mb-4 overflow-hidden">
        <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-[13px]">
          <thead className="border-b border-line bg-surface-2/60 text-left text-xs text-muted"><tr><th className="px-4 py-2">Integration</th><th className="px-4 py-2">Environment variable</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Cost</th></tr></thead>
          <tbody className="divide-y divide-line">
            {keyed.map((c) => (
              <tr key={c.id}>
                <td className="px-4 py-2.5 font-medium">{c.name}</td>
                <td className="px-4 py-2.5"><code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">{c.envVar}</code></td>
                <td className="px-4 py-2.5">{c.status === "planned" ? <Badge>Planned</Badge> : c.configured ? <Badge tone="success">Key set</Badge> : <Badge tone="warn">Not set</Badge>}{c.status !== "planned" && <span className="ml-2">{statusBadge(c)}</span>}</td>
                <td className="px-4 py-2.5 text-xs text-muted">{c.cost}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-4"><p className="text-sm font-semibold">How to configure</p><p className="mt-1 text-[13px] text-muted">Add the variable to <code>.env.local</code> (or your host&apos;s environment settings), then restart the server. See <code>.env.example</code> and <code>docs/INTEGRATIONS.md</code> for step-by-step instructions and cost notes.</p></Card>
        <Card className="p-4"><p className="text-sm font-semibold">Local AI models <Badge>not built</Badge></p><p className="mt-1 text-[13px] text-muted">Optional Ollama-based review analysis and classification are planned but not implemented. All scoring and opportunity detection today is deterministic and explainable, with no AI dependency.</p></Card>
        <Card className="p-4"><p className="text-sm font-semibold">Billing <Badge>not built</Badge></p><p className="mt-1 text-[13px] text-muted">Plans and quotas exist in the data model (daily search quota). No payment integration is included.</p></Card>
        <Card className="p-4"><p className="text-sm font-semibold">Webhooks & CRM sync <Badge>not built</Badge></p><p className="mt-1 text-[13px] text-muted">Export to CSV/XLSX/JSON is available now from All Leads.</p></Card>
      </div>
    </div>
  );
}
