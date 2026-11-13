import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { api } from "@/lib/auth/guard";
import { getDb, schema } from "@/lib/db";
import { generateOutreach } from "@/lib/outreach/templates";
import type { Opportunity } from "@/lib/scoring/types";
import { reverifyLead } from "@/lib/services/verify-lead";

const { leads, leadActivities, outreachDrafts, suppressions } = schema;
type Params = { params: Promise<{ id: string; action: string }> };

const activitySchema = z.object({
  type: z.enum(["note", "call", "email", "sms", "meeting"]),
  body: z.string().trim().max(5000).optional(),
  outcome: z.string().trim().max(60).optional(),
  followUpAt: z.string().datetime().nullable().optional(),
});

const outreachSchema = z.object({
  sender: z.object({ name: z.string().trim().min(1).max(100), company: z.string().trim().min(1).max(120), website: z.string().max(200).optional(), phone: z.string().max(40).optional(), address: z.string().max(300).optional() }),
  save: z.boolean().default(false),
});

export const POST = api(async (req, ctx, { params }: Params) => {
  const { id: rawId, action } = await params;
  const id = z.string().uuid().parse(rawId);
  const db = await getDb();
  const [lead] = await db.select().from(leads).where(and(eq(leads.id, id), eq(leads.orgId, ctx.orgId)));
  if (!lead) return Response.json({ error: "Lead not found." }, { status: 404 });

  if (action === "activities") {
    const b = activitySchema.parse(await req.json());
    await db.insert(leadActivities).values({ leadId: id, orgId: ctx.orgId, userId: ctx.userId, type: b.type, body: b.body ?? null, outcome: b.outcome ?? null, followUpAt: b.followUpAt ? new Date(b.followUpAt) : null });
    const patch: Partial<typeof leads.$inferInsert> = { updatedAt: new Date() };
    if (b.followUpAt) patch.followUpAt = new Date(b.followUpAt);
    // contacting a lead for the first time moves it into the "contacted" stage
    if (["call", "email", "sms", "meeting"].includes(b.type) && ["new", "discovered", "verified", "qualified"].includes(lead.status)) patch.status = "contacted";
    await db.update(leads).set(patch).where(eq(leads.id, id));
    return { ok: true };
  }

  if (action === "reverify") return reverifyLead(ctx.orgId, id);

  if (action === "outreach") {
    const b = outreachSchema.parse(await req.json());
    // Honour do-not-contact and suppression lists before generating anything for outreach.
    const sup = await db.select().from(suppressions).where(eq(suppressions.orgId, ctx.orgId));
    const blocked =
      lead.doNotContact ||
      sup.some((s) => (s.type === "email" && s.value === lead.email?.toLowerCase()) || (s.type === "phone" && s.value === lead.phoneE164) || (s.type === "domain" && s.value === lead.websiteDomain));
    if (blocked) return Response.json({ error: "This lead is marked do-not-contact or is on a suppression list. No outreach drafts are generated." }, { status: 409 });
    const drafts = generateOutreach({
      businessName: lead.name, city: lead.city, subcategory: lead.subcategory, website: lead.website, description: lead.description,
      opportunities: lead.opportunities as Opportunity[], sender: b.sender,
    });
    if (b.save) {
      await db.insert(outreachDrafts).values(drafts.map((d) => ({ orgId: ctx.orgId, leadId: id, channel: d.channel, subject: d.subject ?? null, body: d.body })));
    }
    return { drafts, note: "Drafts are templates grounded in this lead's recorded findings. This platform never sends messages; review and send them yourself, subject to consent and local law." };
  }
  return Response.json({ error: "Unknown action." }, { status: 404 });
});

export const GET = api(async (_req, ctx, { params }: Params) => {
  const { id: rawId, action } = await params;
  const id = z.string().uuid().parse(rawId);
  if (action !== "outreach") return Response.json({ error: "Unknown action." }, { status: 404 });
  const db = await getDb();
  const rows = await db.select().from(outreachDrafts).where(and(eq(outreachDrafts.leadId, id), eq(outreachDrafts.orgId, ctx.orgId))).orderBy(desc(outreachDrafts.createdAt)).limit(50);
  return { drafts: rows };
});
