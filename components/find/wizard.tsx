"use client";
import { AlertTriangle, Check, CheckCircle2, Info, Rocket, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { OPPORTUNITY_KEYS } from "@/lib/search/config";
import { STRATEGIES } from "@/lib/search/strategies";
import { getNiche } from "@/lib/taxonomy/niches";
import type { AdvisorReport } from "@/lib/search/advisor";
import { call, useApi } from "../hooks";
import { Badge, Button, Card, ErrorNote, Field, Input, PageHeader, Select, cx } from "../ui";
import { LocationPicker, type LocationState, type RadiusState } from "./location-picker";
import { NichePicker, rememberNiches, type NicheState } from "./niche-picker";

const STEPS = ["Niches", "Location", "Sources", "Filters", "Strategy", "Review & start"] as const;

interface SourceInfo {
  id: string; name: string; kind: string; status: "live_tested" | "implemented_untested" | "planned"; summary: string; cost: string;
  requiresKey: boolean; envVar?: string; configured: boolean; setupMessage: string | null; limits: string; returns: string[];
}

const OPP_LABEL: Record<string, string> = {
  no_website: "No website", website_unreachable: "Website unreachable", no_ssl: "No valid HTTPS", slow_site: "Slow website", mobile_unfriendly: "Possible poor mobile usability",
  broken_links: "Broken links", outdated_site: "Outdated website", no_online_booking: "No online booking detected", no_online_ordering: "No online ordering detected",
  no_chatbot: "No chat/support widget detected", no_contact_form: "No contact form detected", no_crm_automation: "No CRM/automation detected", limited_presence: "Limited digital presence", incomplete_info: "Incomplete business info",
};

export function FindLeadsWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [niches, setNiches] = useState<NicheState>({ nicheIds: [], customNiches: [], excludeKeywords: [] });
  const [location, setLocation] = useState<LocationState | null>(null);
  const [radius, setRadius] = useState<RadiusState>({ value: 10, unit: "km" });
  const [autoExpand, setAutoExpand] = useState(false);
  const [sources, setSources] = useState<string[]>(["osm"]);
  const [enrich, setEnrich] = useState(true);
  const [strategy, setStrategy] = useState<"precision" | "balanced" | "coverage">("balanced");
  const [name, setName] = useState("");
  const [filters, setFilters] = useState({
    minRating: "", minReviews: "", maxReviews: "", website: "any" as "any" | "has" | "none", requirePhone: false, requireEmail: false, minChannels: "", minScore: "", opportunities: [] as string[],
  });
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const src = useApi<{ connectors: SourceInfo[] }>("/api/sources");
  const [report, setReport] = useState<AdvisorReport | null>(null);
  const [advising, setAdvising] = useState(false);

  const num = (s: string) => (s.trim() === "" ? undefined : Number(s));
  const config = useMemo(
    () => ({
      name: name.trim() || undefined,
      ...niches,
      location: location ?? undefined,
      radius,
      autoExpand,
      sources,
      enrichWebsites: enrich,
      strategy,
      filters: {
        minRating: num(filters.minRating), minReviews: num(filters.minReviews), maxReviews: num(filters.maxReviews), website: filters.website,
        requirePhone: filters.requirePhone, requireEmail: filters.requireEmail, minChannels: num(filters.minChannels), minScore: num(filters.minScore), opportunities: filters.opportunities,
      },
    }),
    [name, niches, location, radius, autoExpand, sources, enrich, strategy, filters],
  );

  // Advisor (debounced) — runs whenever the config changes after step 1 so radius suggestions are live.
  const seq = useRef(0);
  useEffect(() => {
    if (!location || (!niches.nicheIds.length && !niches.customNiches.length)) { setReport(null); return; }
    const my = ++seq.current;
    setAdvising(true);
    const t = setTimeout(async () => {
      try {
        const r = await call<AdvisorReport>("/api/searches/advise", { method: "POST", body: config });
        if (my === seq.current) setReport(r);
      } catch {
        if (my === seq.current) setReport(null);
      } finally {
        if (my === seq.current) setAdvising(false);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [config, location, niches]);

  const canNext = [
    niches.nicheIds.length + niches.customNiches.length > 0,
    !!location && radius.value > 0,
    sources.length > 0,
    true,
    true,
    true,
  ];

  async function start() {
    setStarting(true);
    setError(null);
    try {
      const r = await call<{ id: string }>("/api/searches", { method: "POST", body: config });
      rememberNiches(niches.nicheIds);
      router.push(`/searches/${r.id}`);
    } catch (e) {
      setError((e as Error).message);
      setStarting(false);
    }
  }

  const toggleSource = (id: string) => setSources((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const discovery = (src.data?.connectors ?? []).filter((c) => c.kind === "discovery");

  return (
    <div>
      <PageHeader title="Find leads" description="Define who you're looking for and where. Every search runs as a background job you can monitor, cancel and re-run." />

      <ol className="mb-5 flex flex-wrap gap-1.5" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button
              onClick={() => (i <= step || canNext.slice(0, i).every(Boolean)) && setStep(i)}
              aria-current={i === step ? "step" : undefined}
              className={cx("flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px]", i === step ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:bg-surface-2")}
            >
              <span className={cx("grid size-5 place-items-center rounded-full text-[11px] font-semibold", i < step ? "bg-accent text-accent-fg" : "bg-surface-2")}>
                {i < step ? <Check className="size-3" /> : i + 1}
              </span>
              {s}
            </button>
          </li>
        ))}
      </ol>

      {step === 0 && <NichePicker value={niches} onChange={setNiches} />}

      {step === 1 && (
        <LocationPicker
          location={location} radius={radius} autoExpand={autoExpand} recommendation={report?.radius}
          onLocation={setLocation} onRadius={setRadius} onAutoExpand={setAutoExpand}
        />
      )}

      {step === 2 && (
        <div className="space-y-3">
          <p className="text-sm text-muted">Select one or more sources. Sources that aren&apos;t ready are shown honestly — nothing is listed as working unless it has been implemented and tested.</p>
          <div className="grid gap-3 md:grid-cols-2">
            {discovery.map((c) => {
              const usable = c.configured && c.status !== "planned";
              return (
                <Card key={c.id} className={cx("p-4", !usable && "opacity-80")}>
                  <label className={cx("flex items-start gap-3", usable ? "cursor-pointer" : "cursor-not-allowed")}>
                    <input type="checkbox" disabled={!usable} checked={sources.includes(c.id)} onChange={() => toggleSource(c.id)} className="mt-1 size-4 accent-[var(--accent)]" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{c.name}</span>
                        <StatusPill c={c} />
                      </div>
                      <p className="mt-1 text-[13px] text-muted">{c.summary}</p>
                      <p className="mt-1.5 text-xs"><span className="text-muted">Cost:</span> {c.cost}</p>
                      {c.returns.length > 0 && <p className="mt-0.5 text-xs text-muted">Returns: {c.returns.join(", ")}</p>}
                      {!usable && c.setupMessage && <p className="mt-2 rounded-md bg-warn-soft px-2 py-1 text-xs text-warn">{c.setupMessage}</p>}
                    </div>
                  </label>
                </Card>
              );
            })}
          </div>
          <Card className="p-4">
            <label className="flex cursor-pointer items-start gap-3">
              <input type="checkbox" checked={enrich} onChange={(e) => setEnrich(e.target.checked)} className="mt-1 size-4 accent-[var(--accent)]" />
              <div>
                <span className="font-medium">Visit official business websites</span> <Badge tone="success">live, tested</Badge>
                <p className="mt-1 text-[13px] text-muted">Reads each business&apos;s own public site for published emails, social links and digital gaps (HTTPS, speed, booking, chat…). Respects robots.txt. Adds time to each search; required for opportunity filters.</p>
              </div>
            </label>
          </Card>
          <p className="text-xs text-muted">Not implemented yet: Google web search, BBB, LinkedIn, Facebook, Instagram, Yelp, Foursquare and registries — see Data Sources.</p>
        </div>
      )}

      {step === 3 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="space-y-3 p-4">
            <p className="text-[13px] font-semibold">Business characteristics</p>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Min rating"><Input type="number" min={0} max={5} step={0.1} value={filters.minRating} onChange={(e) => setFilters({ ...filters, minRating: e.target.value })} placeholder="any" /></Field>
              <Field label="Min reviews"><Input type="number" min={0} value={filters.minReviews} onChange={(e) => setFilters({ ...filters, minReviews: e.target.value })} placeholder="any" /></Field>
              <Field label="Max reviews"><Input type="number" min={0} value={filters.maxReviews} onChange={(e) => setFilters({ ...filters, maxReviews: e.target.value })} placeholder="any" /></Field>
            </div>
            <p className="text-xs text-muted">Rating and review data come from Google Places. Leads from sources without it are kept and shown as unrated, not guessed.</p>
            <Field label="Website"><Select value={filters.website} onChange={(e) => setFilters({ ...filters, website: e.target.value as "any" })}><option value="any">Any</option><option value="has">Has a website</option><option value="none">No website listed</option></Select></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Min contact channels" hint="Of phone, email, website, social"><Input type="number" min={0} max={6} value={filters.minChannels} onChange={(e) => setFilters({ ...filters, minChannels: e.target.value })} placeholder="any" /></Field>
              <Field label="Min lead score"><Input type="number" min={0} max={100} value={filters.minScore} onChange={(e) => setFilters({ ...filters, minScore: e.target.value })} placeholder="strategy default" /></Field>
            </div>
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={filters.requirePhone} onChange={(e) => setFilters({ ...filters, requirePhone: e.target.checked })} className="size-4 accent-[var(--accent)]" /> Must have a public phone</label>
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={filters.requireEmail} onChange={(e) => setFilters({ ...filters, requireEmail: e.target.checked })} className="size-4 accent-[var(--accent)]" /> Must have a public email</label>
          </Card>
          <Card className="p-4">
            <p className="text-[13px] font-semibold">Digital opportunity filters</p>
            <p className="mb-3 mt-1 text-xs text-muted">Keep only leads showing at least one of these. “Verified” and “detected” are evidence; “not detected” only means we didn&apos;t see it on the pages checked.</p>
            <div className="grid gap-1 sm:grid-cols-2">
              {OPPORTUNITY_KEYS.map((k) => (
                <label key={k} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-[13px] hover:bg-surface-2">
                  <input type="checkbox" checked={filters.opportunities.includes(k)} onChange={() => setFilters({ ...filters, opportunities: filters.opportunities.includes(k) ? filters.opportunities.filter((x) => x !== k) : [...filters.opportunities, k] })} className="size-4 accent-[var(--accent)]" />
                  {OPP_LABEL[k]}
                </label>
              ))}
            </div>
          </Card>
        </div>
      )}

      {step === 4 && (
        <div className="grid gap-3 md:grid-cols-3">
          {Object.values(STRATEGIES).map((s) => (
            <button key={s.id} onClick={() => setStrategy(s.id)} aria-pressed={strategy === s.id} className={cx("rounded-xl border p-4 text-left", strategy === s.id ? "border-accent bg-accent-soft" : "border-line bg-surface hover:bg-surface-2")}>
              <p className="flex items-center gap-2 font-semibold">{s.label}{strategy === s.id && <CheckCircle2 className="size-4 text-accent" />}</p>
              <p className="mt-1.5 text-[13px] text-muted">{s.blurb}</p>
              <p className="mt-2 text-xs text-muted">Up to {s.maxPerNiche} per niche per source{s.autoExpandDefault ? " · auto-expands radius" : ""}</p>
            </button>
          ))}
          <p className="text-xs text-muted md:col-span-3">You stay in control: your filters above still apply on top of the strategy, and you can change any parameter before starting.</p>
        </div>
      )}

      {step === 5 && (
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <Card className="p-4">
            <p className="mb-2 text-[13px] font-semibold">Search quality assistant {advising && <span className="text-xs font-normal text-muted">· analysing…</span>}</p>
            {!report ? <p className="text-sm text-muted">Complete the niche and location steps to see recommendations.</p> : (
              <ul className="space-y-2">
                {report.advice.map((a, i) => (
                  <li key={i} className="flex gap-2.5 rounded-lg border border-line p-2.5">
                    {a.level === "error" ? <XCircle className="mt-0.5 size-4 shrink-0 text-danger" /> : a.level === "warn" ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" /> : a.level === "ok" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <Info className="mt-0.5 size-4 shrink-0 text-info" />}
                    <div><p className="text-[13px] font-medium">{a.title}</p><p className="text-xs text-muted">{a.detail}</p></div>
                  </li>
                ))}
              </ul>
            )}
            {report && Object.keys(report.likelyFields).length > 0 && (
              <div className="mt-3 border-t border-line pt-3">
                <p className="mb-1 text-xs font-medium">Fields likely to be available</p>
                {Object.entries(report.likelyFields).map(([k, v]) => <p key={k} className="text-xs text-muted"><span className="text-ink">{k}:</span> {v.join(", ")}</p>)}
                <p className="mt-1 text-xs text-muted">Fields marked * on OpenStreetMap are only present when a mapper added them.</p>
              </div>
            )}
          </Card>
          <Card className="space-y-3 p-4">
            <p className="text-[13px] font-semibold">Summary</p>
            <dl className="space-y-1.5 text-[13px]">
              <Row k="Niches" v={[...niches.nicheIds.map((id) => getNiche(id)?.name ?? id), ...niches.customNiches].join(", ") || "—"} />
              <Row k="Location" v={location?.label ?? "—"} />
              <Row k="Radius" v={`${radius.value} ${radius.unit}`} />
              <Row k="Sources" v={sources.join(", ") + (enrich ? " + websites" : "")} />
              <Row k="Strategy" v={STRATEGIES[strategy].label} />
              {niches.excludeKeywords.length > 0 && <Row k="Excluding" v={niches.excludeKeywords.join(", ")} />}
            </dl>
            <Field label="Search name (optional)"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Auto-named if left blank" /></Field>
            {error && <ErrorNote>{error}</ErrorNote>}
            <Button variant="primary" className="w-full" onClick={start} loading={starting} disabled={report ? !report.canStart : false}>
              <Rocket className="size-4" /> Start search
            </Button>
            <p className="text-xs text-muted">Runs in the background. You&apos;ll see real progress, request failures and rate-limit warnings as they happen.</p>
          </Card>
        </div>
      )}

      <div className="mt-6 flex items-center justify-between">
        <Button variant="ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</Button>
        {step < STEPS.length - 1 && <Button variant="primary" disabled={!canNext[step]} onClick={() => setStep(step + 1)}>Continue</Button>}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex gap-3"><dt className="w-20 shrink-0 text-muted">{k}</dt><dd className="min-w-0 break-words">{v}</dd></div>;
}

function StatusPill({ c }: { c: SourceInfo }) {
  if (c.status === "planned") return <Badge>planned</Badge>;
  if (!c.configured) return <Badge tone="warn">needs API key</Badge>;
  if (c.status === "live_tested") return <Badge tone="success">live, tested</Badge>;
  return <Badge tone="info">ready · untested</Badge>;
}
