import { z } from "zod";
import { api } from "@/lib/auth/guard";
import { getDb, schema } from "@/lib/db";
import { buildExport, EXPORT_COLUMNS } from "@/lib/export/export";
import { leadFilterSchema } from "@/lib/services/leads";

const bodySchema = z.object({
  format: z.enum(["csv", "xls", "xlsx", "json"]),
  columns: z.array(z.string()).max(60).optional(),
  filter: z.record(z.string(), z.string()).default({}),
  ids: z.array(z.string().uuid()).max(5000).optional(),
});

export const GET = api(async () => ({ columns: EXPORT_COLUMNS.map((c) => ({ key: c.key, header: c.header })) }));

export const POST = api(async (req, ctx) => {
  const b = bodySchema.parse(await req.json());
  const filter = leadFilterSchema.parse({ ...b.filter, ...(b.ids?.length ? { ids: b.ids.join(",") } : {}) });
  const out = await buildExport(ctx.orgId, filter, b.format, b.columns, { filters: b.filter, selectedIds: b.ids?.length ?? 0 });
  const db = await getDb();
  await db.insert(schema.auditLogs).values({ orgId: ctx.orgId, userId: ctx.userId, action: "export", detail: { format: b.format, count: out.count, excluded: out.excluded } });
  return new Response(out.body as BodyInit, {
    headers: {
      "content-type": out.contentType,
      "content-disposition": `attachment; filename="${out.filename}"`,
      "x-export-count": String(out.count),
      "x-export-excluded": String(out.excluded),
      "cache-control": "no-store",
    },
  });
}, { role: "member" });
