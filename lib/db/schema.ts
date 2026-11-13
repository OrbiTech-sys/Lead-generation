import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: createdAt(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(), // sha256 of the cookie token
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  orgId: uuid("org_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  plan: text("plan").notNull().default("free"),
  scoringWeights: jsonb("scoring_weights"),
  dailySearchQuota: integer("daily_search_quota").notNull().default(50),
  createdAt: createdAt(),
});

export const memberships = pgTable(
  "memberships",
  {
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"), // owner | admin | member | viewer
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] })],
);

export const searches = pgTable(
  "searches",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id),
    name: text("name").notNull(),
    config: jsonb("config").notNull(),
    status: text("status").notNull().default("queued"), // queued|running|completed|failed|cancelled
    cancelRequested: boolean("cancel_requested").notNull().default(false),
    stats: jsonb("stats").notNull().default({}),
    error: text("error"),
    saved: boolean("saved").notNull().default(false),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("searches_org_idx").on(t.orgId, t.createdAt)],
);

export const searchEvents = pgTable(
  "search_events",
  {
    id: id(),
    searchId: uuid("search_id").notNull().references(() => searches.id, { onDelete: "cascade" }),
    level: text("level").notNull().default("info"), // info | warn | error
    source: text("source"),
    message: text("message").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("search_events_idx").on(t.searchId, t.createdAt)],
);

export const leads = pgTable(
  "leads",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    searchId: uuid("search_id").references(() => searches.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    nameNorm: text("name_norm").notNull(),
    nicheId: text("niche_id"),
    industry: text("industry"),
    subcategory: text("subcategory"),
    country: text("country"),
    state: text("state"),
    city: text("city"),
    address: text("address"),
    postcode: text("postcode"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    phone: text("phone"),
    phoneE164: text("phone_e164"),
    phoneType: text("phone_type"),
    phoneStatus: text("phone_status").notNull().default("unverified"),
    email: text("email"),
    emailStatus: text("email_status").notNull().default("unverified"),
    emailSourceUrl: text("email_source_url"),
    website: text("website"),
    websiteDomain: text("website_domain"),
    websiteStatus: text("website_status").notNull().default("unknown"),
    mapsUrl: text("maps_url"),
    rating: doublePrecision("rating"),
    reviewCount: integer("review_count"),
    facebook: text("facebook"),
    instagram: text("instagram"),
    linkedin: text("linkedin"),
    description: text("description"),
    contactPerson: text("contact_person"),
    contactPosition: text("contact_position"),
    openingHours: text("opening_hours"),
    businessStatus: text("business_status"),
    matchBasis: text("match_basis"),
    sourcePrimary: text("source_primary").notNull(),
    sourceCount: integer("source_count").notNull().default(1),
    // CRM
    status: text("status").notNull().default("discovered"),
    tags: text("tags").array().notNull().default([]),
    assignedTo: uuid("assigned_to").references(() => users.id, { onDelete: "set null" }),
    followUpAt: timestamp("follow_up_at", { withTimezone: true }),
    doNotContact: boolean("do_not_contact").notNull().default(false),
    // intelligence
    score: integer("score").notNull().default(0),
    scoreBreakdown: jsonb("score_breakdown"),
    classification: text("classification").notNull().default("needs_verification"),
    verificationStatus: text("verification_status").notNull().default("unverified"),
    opportunities: jsonb("opportunities").notNull().default([]),
    websiteAudit: jsonb("website_audit"),
    isDemo: boolean("is_demo").notNull().default(false),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    sourceDataAt: timestamp("source_data_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("leads_org_score_idx").on(t.orgId, t.score),
    index("leads_org_domain_idx").on(t.orgId, t.websiteDomain),
    index("leads_org_phone_idx").on(t.orgId, t.phoneE164),
    index("leads_org_status_idx").on(t.orgId, t.status),
  ],
);

export const leadSources = pgTable(
  "lead_sources",
  {
    id: id(),
    leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    sourceRecordId: text("source_record_id").notNull(),
    sourceUrl: text("source_url"),
    raw: jsonb("raw"),
    searchId: uuid("search_id").references(() => searches.id, { onDelete: "set null" }),
    collectedAt: timestamp("collected_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("lead_sources_uniq").on(t.leadId, t.source, t.sourceRecordId)],
);

export const leadActivities = pgTable(
  "lead_activities",
  {
    id: id(),
    leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    type: text("type").notNull(), // note | call | email | sms | meeting | status_change
    body: text("body"),
    outcome: text("outcome"),
    followUpAt: timestamp("follow_up_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("lead_activities_idx").on(t.leadId, t.createdAt)],
);

export const mergeCandidates = pgTable("merge_candidates", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  leadAId: uuid("lead_a_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  leadBId: uuid("lead_b_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  confidence: doublePrecision("confidence").notNull(),
  reasons: jsonb("reasons").notNull().default([]),
  status: text("status").notNull().default("pending"), // pending | merged | rejected
  createdAt: createdAt(),
});

export const mergeHistory = pgTable("merge_history", {
  id: id(),
  orgId: uuid("org_id").notNull(),
  survivorId: uuid("survivor_id").notNull(),
  mergedSnapshot: jsonb("merged_snapshot").notNull(), // full lead row + its sources
  mode: text("mode").notNull(), // auto | manual
  confidence: doublePrecision("confidence"),
  undone: boolean("undone").notNull().default(false),
  createdAt: createdAt(),
});

export const lists = pgTable("lists", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: createdAt(),
});

export const listItems = pgTable(
  "list_items",
  {
    listId: uuid("list_id").notNull().references(() => lists.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.listId, t.leadId] })],
);

export const pipelineStages = pgTable(
  "pipeline_stages",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    position: integer("position").notNull(),
    color: text("color").notNull().default("#64748b"),
  },
  (t) => [uniqueIndex("pipeline_stage_uniq").on(t.orgId, t.key)],
);

export const savedNiches = pgTable("saved_niches", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  nicheIds: text("niche_ids").array().notNull(),
  createdAt: createdAt(),
});

export const suppressions = pgTable(
  "suppressions",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // email | phone | domain
    value: text("value").notNull(),
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("suppression_uniq").on(t.orgId, t.type, t.value)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    orgId: uuid("org_id"),
    userId: uuid("user_id"),
    action: text("action").notNull(),
    detail: jsonb("detail"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_org_idx").on(t.orgId, t.createdAt)],
);

export const apiUsage = pgTable(
  "api_usage",
  {
    orgId: uuid("org_id").notNull(),
    provider: text("provider").notNull(),
    day: text("day").notNull(), // YYYY-MM-DD
    requests: integer("requests").notNull().default(0),
    errors: integer("errors").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.provider, t.day] })],
);

export const outreachDrafts = pgTable("outreach_drafts", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  channel: text("channel").notNull(), // email | sms | call
  subject: text("subject"),
  body: text("body").notNull(),
  createdAt: createdAt(),
});
