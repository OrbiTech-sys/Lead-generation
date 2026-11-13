"use client";
import { UserPlus } from "lucide-react";
import { useState } from "react";
import { call, useApi } from "../hooks";
import { fmtDate } from "../labels";
import { Button, Card, CardHeader, ErrorNote, Field, Input, PageHeader, Select, Spinner } from "../ui";

interface Member { userId: string; name: string; email: string; role: string; joined: string; assigned: number }

export function TeamView() {
  const { data, error, loading, reload } = useApi<{ members: Member[]; me: string; myRole: string }>("/api/team");
  const [form, setForm] = useState({ name: "", email: "", role: "member" });
  const [err, setErr] = useState<string | null>(null);
  const [temp, setTemp] = useState<{ email: string; password: string } | null>(null);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorNote>{error}</ErrorNote>;
  const d = data!;
  const canManage = d.myRole === "owner" || d.myRole === "admin";

  async function run(fn: () => Promise<void>) {
    setErr(null);
    try { await fn(); await reload(); } catch (e) { setErr((e as Error).message); }
  }

  return (
    <div>
      <PageHeader title="Team" description="Roles: Owner (everything) · Admin (settings, team, deletion) · Member (search, edit leads, export) · Viewer (read-only)." />
      {err && <div className="mb-3"><ErrorNote>{err}</ErrorNote></div>}
      {canManage && (
        <Card className="mb-4 p-4">
          <p className="mb-2 text-[13px] font-semibold">Add a team member</p>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Name" className="w-full sm:w-48"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={100} /></Field>
            <Field label="Email" className="w-full sm:w-64"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Role" className="w-full sm:w-36"><Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}><option value="admin">Admin</option><option value="member">Member</option><option value="viewer">Viewer</option></Select></Field>
            <Button variant="primary" disabled={!form.name.trim() || !form.email.trim()} onClick={() => run(async () => { const r = await call<{ temporaryPassword: string }>("/api/team", { method: "POST", body: form }); setTemp({ email: form.email, password: r.temporaryPassword }); setForm({ name: "", email: "", role: "member" }); })}><UserPlus className="size-4" /> Create account</Button>
          </div>
          <p className="mt-2 text-xs text-muted">Email invitations aren&apos;t set up yet, so you create the account and share a one-time temporary password.</p>
          {temp && <p role="status" className="mt-3 rounded-lg bg-success-soft px-3 py-2 text-[13px] text-success">Account created for {temp.email}. Temporary password (shown once): <code className="font-mono font-semibold">{temp.password}</code></p>}
        </Card>
      )}
      <Card>
        <CardHeader title={`Members (${d.members.length})`} />
        <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-[13px]">
          <thead className="border-b border-line text-left text-xs text-muted"><tr><th className="px-4 py-2">Member</th><th className="px-4 py-2">Role</th><th className="px-4 py-2">Assigned leads</th><th className="px-4 py-2">Joined</th><th /></tr></thead>
          <tbody className="divide-y divide-line">
            {d.members.map((m) => (
              <tr key={m.userId}>
                <td className="px-4 py-2.5"><p className="font-medium">{m.name}{m.userId === d.me && <span className="ml-1 text-xs text-muted">(you)</span>}</p><p className="text-xs text-muted">{m.email}</p></td>
                <td className="px-4 py-2.5">
                  {canManage && m.userId !== d.me ? (
                    <Select value={m.role} onChange={(e) => run(() => call("/api/team", { method: "PATCH", body: { userId: m.userId, role: e.target.value } }).then(() => undefined))} className="h-8 w-32 text-[13px]" aria-label={`Role for ${m.name}`}>
                      {d.myRole === "owner" && <option value="owner">Owner</option>}<option value="admin">Admin</option><option value="member">Member</option><option value="viewer">Viewer</option>
                    </Select>
                  ) : <span className="capitalize">{m.role}</span>}
                </td>
                <td className="tabular px-4 py-2.5">{m.assigned}</td>
                <td className="px-4 py-2.5 text-muted">{fmtDate(m.joined)}</td>
                <td className="px-4 py-2.5 text-right">{canManage && m.userId !== d.me && <Button size="sm" variant="ghost" onClick={() => confirm(`Remove ${m.name} from the workspace?`) && run(() => call("/api/team", { method: "DELETE", body: { userId: m.userId } }).then(() => undefined))}>Remove</Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </Card>
    </div>
  );
}
