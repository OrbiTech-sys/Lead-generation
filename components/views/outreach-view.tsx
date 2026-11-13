"use client";
import { PhoneCall } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useApi } from "../hooks";
import { fmtDate, relTime } from "../labels";
import { Badge, Card, CardHeader, Empty, ErrorNote, PageHeader, Select, Spinner } from "../ui";

interface Data {
  recent: { id: string; leadId: string; leadName: string; type: string; body: string | null; outcome: string | null; followUpAt: string | null; createdAt: string; userName: string | null }[];
  followUps: { id: string; name: string; followUpAt: string; status: string; phone: string | null; email: string | null }[];
  outcomes: { outcome: string; n: number }[];
}

export function OutreachView() {
  const [type, setType] = useState("");
  const { data, error, loading } = useApi<Data>(`/api/activities${type ? `?type=${type}` : ""}`);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorNote>{error}</ErrorNote>;
  const d = data!;
  const now = Date.now();
  return (
    <div>
      <PageHeader title="Outreach tracker" description="Calls, emails and meetings you've logged against leads, with follow-ups due. Log activity from a lead's Activity tab. This platform tracks outreach — it doesn't send messages." actions={
        <Select value={type} onChange={(e) => setType(e.target.value)} className="w-40" aria-label="Activity type"><option value="">All types</option><option value="call">Calls</option><option value="email">Emails</option><option value="sms">SMS</option><option value="meeting">Meetings</option></Select>
      } />
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader title="Recent outreach" />
          {d.recent.length === 0 ? <Empty title="No outreach logged yet" icon={<PhoneCall className="size-6" />}>Open a lead and log a call, email or meeting.</Empty> : (
            <ul className="divide-y divide-line">
              {d.recent.map((a) => (
                <li key={a.id} className="px-4 py-2.5">
                  <div className="flex items-center justify-between gap-2"><Link href={`/leads?open=${a.leadId}`} className="text-[13px] font-medium hover:text-accent">{a.leadName}</Link><span className="text-xs text-muted">{relTime(a.createdAt)}</span></div>
                  <p className="text-xs text-muted"><span className="capitalize">{a.type}</span>{a.outcome ? ` · ${a.outcome}` : ""} · {a.userName ?? "—"}</p>
                  {a.body && <p className="mt-0.5 text-[13px]">{a.body}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Follow-ups" hint="Earliest first" />
            {d.followUps.length === 0 ? <Empty title="No follow-ups scheduled" /> : (
              <ul className="divide-y divide-line">
                {d.followUps.map((f) => {
                  const overdue = new Date(f.followUpAt).getTime() < now;
                  return <li key={f.id} className="flex items-center justify-between gap-2 px-4 py-2.5"><Link href={`/leads?open=${f.id}`} className="min-w-0 truncate text-[13px] hover:text-accent">{f.name}</Link><Badge tone={overdue ? "danger" : "info"}>{overdue ? "Overdue · " : ""}{fmtDate(f.followUpAt)}</Badge></li>;
                })}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Outcomes" />
            {d.outcomes.length === 0 ? <Empty title="No outcomes yet" /> : <ul className="divide-y divide-line">{d.outcomes.map((o) => <li key={o.outcome} className="flex justify-between px-4 py-2 text-[13px]"><span>{o.outcome}</span><span className="tabular text-muted">{o.n}</span></li>)}</ul>}
          </Card>
        </div>
      </div>
    </div>
  );
}
