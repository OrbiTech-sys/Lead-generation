"use client";
import { FolderKanban, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { call, useApi } from "../hooks";
import { fmtDate } from "../labels";
import { Button, Card, Empty, ErrorNote, Field, Input, PageHeader, Spinner } from "../ui";

export function ListsView() {
  const { data, error, loading, reload } = useApi<{ lists: { id: string; name: string; description: string | null; count: number; createdAt: string }[] }>("/api/lists");
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function create() {
    setErr(null);
    try {
      await call("/api/lists", { method: "POST", body: { name, description: desc || undefined } });
      setName(""); setDesc("");
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  async function remove(id: string, n: string) {
    if (!confirm(`Delete the list "${n}"? The leads stay in your workspace.`)) return;
    try {
      await call("/api/lists", { method: "DELETE", body: { id } });
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <div>
      <PageHeader title="Lead lists" description="Group leads for campaigns or clients. Add leads from the All Leads table (select rows → Add to list)." />
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="List name" className="w-64"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="e.g. Brooklyn dentists — Q4" /></Field>
          <Field label="Description (optional)" className="min-w-64 flex-1"><Input value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={300} /></Field>
          <Button variant="primary" onClick={create} disabled={!name.trim()}><Plus className="size-4" /> Create list</Button>
        </div>
        {err && <div className="mt-3"><ErrorNote>{err}</ErrorNote></div>}
      </Card>
      {loading && !data ? <Spinner /> : error ? <ErrorNote>{error}</ErrorNote> : data!.lists.length === 0 ? (
        <Card><Empty title="No lists yet" icon={<FolderKanban className="size-6" />}>Create a list above, then add leads from the All Leads table.</Empty></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data!.lists.map((l) => (
            <Card key={l.id} className="flex flex-col p-4">
              <div className="flex items-start justify-between gap-2">
                <Link href={`/leads?listId=${l.id}`} className="min-w-0 font-medium hover:text-accent">{l.name}</Link>
                <button onClick={() => remove(l.id, l.name)} aria-label={`Delete ${l.name}`} className="rounded p-1 text-muted hover:bg-surface-2 hover:text-danger"><Trash2 className="size-4" /></button>
              </div>
              {l.description && <p className="mt-1 text-[13px] text-muted">{l.description}</p>}
              <p className="mt-auto pt-3 text-xs text-muted">{l.count} lead{l.count === 1 ? "" : "s"} · created {fmtDate(l.createdAt)}</p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
