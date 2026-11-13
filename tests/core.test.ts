import { describe, expect, it } from "vitest";
import { ALL_NICHES, SUGGESTED_COMBINATIONS, TAXONOMY, customNiche, getNiche, resolveNiches, searchNiches } from "@/lib/taxonomy/niches";
import { boundingBox, fromKm, haversineKm, toKm } from "@/lib/geo/distance";
import { classifyArea, recommendRadius } from "@/lib/geo/recommend";
import { checkPhone } from "@/lib/verify/phone";
import { checkEmail, validateEmailSyntax, isDisposable } from "@/lib/verify/email";

describe("niche taxonomy", () => {
  it("covers all 17 spec categories with unique ids", () => {
    expect(TAXONOMY).toHaveLength(17);
    const ids = ALL_NICHES.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ALL_NICHES.length).toBeGreaterThan(190);
  });
  it("every niche is searchable by at least one method", () => {
    for (const n of ALL_NICHES) expect(n.osm.length + n.kw.length, n.id).toBeGreaterThan(0);
  });
  it("searches by name and category, supports multiple and custom niches", () => {
    expect(searchNiches("dental")[0].name).toBe("Dental clinics");
    expect(searchNiches("healthcare").every((n) => n.categoryId === "healthcare-and-medical")).toBe(true);
    const r = resolveNiches(["healthcare-and-medical.dental-clinics", "nope"], ["Drone repair"]);
    expect(r.map((n) => n.name)).toEqual(["Dental clinics", "Drone repair"]);
    expect(customNiche("Drone repair").custom).toBe(true);
  });
  it("suggested combinations reference real niches", () => {
    for (const c of SUGGESTED_COMBINATIONS) for (const id of c.ids) expect(getNiche(id), id).toBeTruthy();
  });
});

describe("geo", () => {
  it("haversine matches known distance (NYC–Boston ≈ 306 km)", () => {
    expect(haversineKm(40.7128, -74.006, 42.3601, -71.0589)).toBeGreaterThan(300);
    expect(haversineKm(40.7128, -74.006, 42.3601, -71.0589)).toBeLessThan(312);
    expect(haversineKm(10, 10, 10, 10)).toBe(0);
  });
  it("converts km <-> miles", () => {
    expect(toKm(10, "mi")).toBeCloseTo(16.09, 1);
    expect(fromKm(16.09344, "mi")).toBeCloseTo(10, 5);
    expect(toKm(10, "km")).toBe(10);
  });
  it("bounding box contains points on the circle", () => {
    const b = boundingBox(40, -74, 10);
    expect(b.north).toBeGreaterThan(40.08);
    expect(b.south).toBeLessThan(39.92);
    expect(b.east - b.west).toBeGreaterThan(b.north - b.south);
  });
  it("recommends smaller radii for dense niches in metros, larger for sparse in rural", () => {
    const dense = recommendRadius({ densities: ["dense"], area: "metro", nicheNames: ["Restaurants"] });
    const sparse = recommendRadius({ densities: ["sparse"], area: "rural", nicheNames: ["Law firms"] });
    expect(dense.recommendedKm).toBeLessThan(sparse.recommendedKm);
    expect(dense.expectedLeads).toBeUndefined(); // no history => no volume estimate
    expect(dense.basis).toBe("heuristic");
  });
  it("uses history only when there is enough of it", () => {
    const r = recommendRadius({
      densities: ["medium"], area: "city", nicheNames: ["Dental"], targetLeads: 40,
      history: [{ nicheIds: ["a"], radiusKm: 10, leads: 60 }, { nicheIds: ["a"], radiusKm: 5, leads: 20 }],
    });
    expect(r.basis).toBe("history");
    expect(r.expectedLeads?.basedOnSearches).toBe(2);
  });
  it("classifies area types", () => {
    expect(classifyArea("administrative", "suburb")).toBe("metro");
    expect(classifyArea("city")).toBe("city");
    expect(classifyArea("village")).toBe("rural");
  });
});

describe("phone verification", () => {
  it("normalises to E.164 and marks format-valid", () => {
    const r = checkPhone("(718) 622-8950", "US")!;
    expect(r.e164).toBe("+17186228950");
    expect(r.status).toBe("valid_format");
    expect(r.note).toMatch(/not verified/i);
  });
  it("handles international numbers and multiple values", () => {
    expect(checkPhone("+44 20 7946 0958; +44 20 7946 0000")!.e164).toBe("+442079460958");
  });
  it("rejects garbage and returns null for empty", () => {
    expect(checkPhone("12")!.status).toBe("invalid");
    expect(checkPhone("")).toBeNull();
    expect(checkPhone(null)).toBeNull();
  });
});

describe("email verification", () => {
  it("validates syntax", () => {
    expect(validateEmailSyntax("info@acme.com")).toBe(true);
    for (const bad of ["a@b", "no-at.com", "a..b@x.com", "@x.com", "a@x..com"]) expect(validateEmailSyntax(bad), bad).toBe(false);
  });
  it("flags disposable domains", () => {
    expect(isDisposable("x@mailinator.com")).toBe(true);
    expect(isDisposable("x@acme.com")).toBe(false);
  });
  it("maps DNS outcomes to statuses without sending mail", async () => {
    expect((await checkEmail("a@acme.com", async () => "mx"))!.status).toBe("domain_verified");
    expect((await checkEmail("a@acme.com", async () => "a-only"))!.status).toBe("uncertain");
    expect((await checkEmail("a@acme.com", async () => "none"))!.status).toBe("invalid");
    expect((await checkEmail("a@acme.com", async () => "error"))!.status).toBe("valid_format");
    expect((await checkEmail("a@mailinator.com", async () => "mx"))!.status).toBe("invalid");
    expect(await checkEmail("", async () => "mx")).toBeNull();
  });
});
