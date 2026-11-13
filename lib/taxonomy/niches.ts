/**
 * Hierarchical niche taxonomy. Expandable: add a category or subcategory here and it appears everywhere.
 * Users can also create custom niches (free-text keywords) at search time.
 *
 * Per-niche hints used by connectors / advisor:
 *  osm      OpenStreetMap tag filters ("key=value", or "key" for any value). OR-combined.
 *  kw       name-keyword fallback for niches OSM does not tag well (matched against business name; lower precision)
 *  g        Google Places primary type (table A), used by the Google connector
 *  density  typical business density: dense | medium | sparse (drives radius recommendations)
 *  book     appointment/booking is a natural feature (drives "no online booking" opportunity)
 *  order    online ordering is a natural feature (restaurants, retail)
 */
export type Density = "dense" | "medium" | "sparse";

export interface Niche {
  id: string;
  name: string;
  categoryId: string;
  category: string;
  osm: string[];
  kw: string[];
  g?: string;
  density: Density;
  book: boolean;
  order: boolean;
  custom?: boolean;
}

export interface NicheCategory {
  id: string;
  name: string;
  niches: Niche[];
}

interface Hint {
  osm?: string[];
  kw?: string[];
  g?: string;
  d?: Density;
  book?: boolean;
  order?: boolean;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

type Row = [string, Hint?];

function category(name: string, defaults: Hint, rows: Row[]): NicheCategory {
  const categoryId = slug(name);
  return {
    id: categoryId,
    name,
    niches: rows.map(([n, h]) => ({
      id: `${categoryId}.${slug(n)}`,
      name: n,
      categoryId,
      category: name,
      osm: h?.osm ?? [],
      kw: h?.kw ?? (h?.osm ? [] : [n.toLowerCase().replace(/ (companies|firms|businesses|services|agencies|stores|shops)$/, "")]),
      g: h?.g,
      density: h?.d ?? defaults.d ?? "medium",
      book: h?.book ?? defaults.book ?? false,
      order: h?.order ?? defaults.order ?? false,
    })),
  };
}

export const TAXONOMY: NicheCategory[] = [
  category("Food, Hospitality & Restaurants", { d: "dense", order: true }, [
    ["Restaurants", { osm: ["amenity=restaurant"], g: "restaurant", book: true }],
    ["Fast food restaurants", { osm: ["amenity=fast_food"], g: "fast_food_restaurant" }],
    ["Cafes", { osm: ["amenity=cafe"], g: "cafe" }],
    ["Coffee shops", { osm: ["shop=coffee"], kw: ["coffee"], g: "coffee_shop" }],
    ["Bakeries", { osm: ["shop=bakery"], g: "bakery" }],
    ["Pizzerias", { osm: ["cuisine=pizza"], kw: ["pizza"], g: "pizza_restaurant" }],
    ["Burger shops", { osm: ["cuisine=burger"], kw: ["burger"], g: "hamburger_restaurant" }],
    ["Ice cream shops", { osm: ["amenity=ice_cream"], g: "ice_cream_shop" }],
    ["Food trucks", { kw: ["food truck"], d: "sparse" }],
    ["Catering companies", { osm: ["craft=caterer"], g: "catering_service", d: "medium", book: true }],
    ["Cloud kitchens", { kw: ["cloud kitchen", "ghost kitchen"], d: "sparse" }],
    ["Fine dining restaurants", { kw: ["fine dining"], g: "fine_dining_restaurant", book: true }],
    ["Bars and pubs", { osm: ["amenity=bar", "amenity=pub"], g: "bar" }],
    ["Hotels", { osm: ["tourism=hotel"], g: "hotel", d: "medium", book: true }],
    ["Motels", { osm: ["tourism=motel"], g: "motel", d: "sparse", book: true }],
    ["Resorts", { kw: ["resort"], g: "resort_hotel", d: "sparse", book: true }],
    ["Guest houses", { osm: ["tourism=guest_house"], g: "guest_house", d: "sparse", book: true }],
    ["Event venues", { osm: ["amenity=events_venue"], g: "event_venue", d: "medium", book: true }],
  ]),
  category("Beauty, Personal Care & Wellness", { d: "dense", book: true }, [
    ["Hair salons", { osm: ["shop=hairdresser"], g: "hair_salon" }],
    ["Barbershops", { osm: ["shop=barber"], kw: ["barber"], g: "barber_shop" }],
    ["Nail salons", { kw: ["nail"], g: "nail_salon" }],
    ["Beauty salons", { osm: ["shop=beauty"], g: "beauty_salon" }],
    ["Spas", { osm: ["leisure=spa", "shop=spa"], kw: ["spa"], g: "spa" }],
    ["Massage centers", { osm: ["shop=massage"], g: "massage", d: "medium" }],
    ["Skincare clinics", { kw: ["skin care", "skincare"], g: "skin_care_clinic", d: "medium" }],
    ["Med spas", { kw: ["med spa", "medspa", "medical spa"], d: "sparse" }],
    ["Cosmetic clinics", { kw: ["cosmetic"], d: "sparse" }],
    ["Makeup artists", { kw: ["makeup"], d: "sparse" }],
    ["Tattoo studios", { osm: ["shop=tattoo"], g: "tattoo_shop", d: "medium" }],
    ["Fitness and wellness studios", { kw: ["wellness"], d: "medium" }],
  ]),
  category("Healthcare & Medical", { d: "medium", book: true }, [
    ["Dental clinics", { osm: ["amenity=dentist", "healthcare=dentist"], g: "dentist" }],
    ["General practitioners", { osm: ["healthcare=doctor", "amenity=doctors"], g: "doctor" }],
    ["Dermatologists", { kw: ["dermatolog"], g: "doctor", d: "sparse" }],
    ["Ophthalmologists", { kw: ["ophthalmolog", "eye care", "eye clinic"], d: "sparse" }],
    ["Physiotherapists", { osm: ["healthcare=physiotherapist"], g: "physiotherapist" }],
    ["Chiropractors", { kw: ["chiropract"], g: "chiropractor" }],
    ["Veterinary clinics", { osm: ["amenity=veterinary"], g: "veterinary_care" }],
    ["Diagnostic laboratories", { osm: ["healthcare=laboratory"], kw: ["diagnostic", "laborator"], d: "sparse" }],
    ["Medical centers", { osm: ["amenity=clinic", "healthcare=clinic"], g: "medical_clinic" }],
    ["Hospitals", { osm: ["amenity=hospital"], g: "hospital", d: "sparse" }],
    ["Mental health practices", { osm: ["healthcare=psychotherapist"], kw: ["therapy", "counsel", "psycholog"], d: "sparse" }],
    ["Home healthcare providers", { kw: ["home health", "home care"], d: "sparse" }],
    ["Pharmacies", { osm: ["amenity=pharmacy"], g: "pharmacy", d: "dense", book: false }],
  ]),
  category("Real Estate & Property Management", { d: "medium" }, [
    ["Real estate agencies", { osm: ["office=estate_agent"], g: "real_estate_agency" }],
    ["Property management companies", { kw: ["property management"], d: "sparse" }],
    ["Commercial real estate agencies", { kw: ["commercial real estate"], d: "sparse" }],
    ["Residential property managers", { kw: ["property manage"], d: "sparse" }],
    ["Real estate investors", { kw: ["real estate invest"], d: "sparse" }],
    ["Realtors", { kw: ["realtor"], d: "medium" }],
    ["Property developers", { osm: ["office=property_developer"], kw: ["developer", "developments"], d: "sparse" }],
    ["Rental agencies", { kw: ["rental agency", "lettings"], d: "sparse" }],
    ["Vacation rental managers", { kw: ["vacation rental"], d: "sparse" }],
    ["Construction management companies", { kw: ["construction management"], d: "sparse" }],
    ["Housing associations", { kw: ["housing association"], d: "sparse" }],
  ]),
  category("Home Services & Contractors", { d: "medium", book: true }, [
    ["Plumbing companies", { osm: ["craft=plumber"], g: "plumber" }],
    ["HVAC contractors", { osm: ["craft=hvac"], kw: ["hvac", "heating", "air conditioning"], g: "hvac_contractor" }],
    ["Electrical contractors", { osm: ["craft=electrician"], g: "electrician" }],
    ["Roofing companies", { osm: ["craft=roofer"], g: "roofing_contractor" }],
    ["Painting contractors", { osm: ["craft=painter"], g: "painter" }],
    ["Landscaping companies", { osm: ["craft=gardener"], kw: ["landscap"], g: "landscaper" }],
    ["Cleaning services", { osm: ["shop=dry_cleaning"], kw: ["cleaning"], d: "medium" }],
    ["Pest control companies", { kw: ["pest control", "exterminat"], d: "sparse" }],
    ["Pool maintenance companies", { kw: ["pool service", "pool maintenance", "pools"], d: "sparse" }],
    ["Interior designers", { osm: ["craft=interior_decorator"], kw: ["interior design"], d: "sparse" }],
    ["Home renovation companies", { kw: ["renovation", "remodel"], d: "sparse" }],
    ["Flooring companies", { osm: ["shop=flooring"], kw: ["flooring"], d: "sparse" }],
    ["Locksmiths", { osm: ["craft=locksmith", "shop=locksmith"], g: "locksmith", d: "sparse" }],
    ["Moving companies", { kw: ["moving", "movers"], g: "moving_company", d: "sparse" }],
    ["Solar installation companies", { osm: ["craft=solar_panel_installer"], kw: ["solar"], d: "sparse" }],
    ["General contractors", { osm: ["craft=builder"], g: "general_contractor", d: "medium" }],
  ]),
  category("Automotive", { d: "medium", book: true }, [
    ["Car dealerships", { osm: ["shop=car"], g: "car_dealer", d: "sparse", book: false }],
    ["Used car dealerships", { kw: ["used car", "pre-owned"], d: "sparse", book: false }],
    ["Auto repair shops", { osm: ["shop=car_repair"], g: "car_repair" }],
    ["Car washes", { osm: ["amenity=car_wash"], g: "car_wash" }],
    ["Auto detailing businesses", { kw: ["detailing"], d: "sparse" }],
    ["Tire shops", { osm: ["shop=tyres"], g: "tire_shop" }],
    ["Auto body shops", { kw: ["body shop", "collision"], d: "sparse" }],
    ["Vehicle rental companies", { osm: ["amenity=car_rental"], g: "car_rental", d: "sparse" }],
    ["Motorcycle dealerships", { osm: ["shop=motorcycle"], d: "sparse", book: false }],
    ["Auto parts stores", { osm: ["shop=car_parts"], g: "auto_parts_store", book: false }],
    ["Towing companies", { kw: ["towing", "tow "], d: "sparse" }],
  ]),
  category("Retail & E-commerce", { d: "dense", order: true }, [
    ["Clothing stores", { osm: ["shop=clothes"], g: "clothing_store" }],
    ["Fashion boutiques", { osm: ["shop=boutique"], kw: ["boutique"] }],
    ["Jewelry stores", { osm: ["shop=jewelry"], g: "jewelry_store" }],
    ["Furniture stores", { osm: ["shop=furniture"], g: "furniture_store", d: "medium" }],
    ["Electronics stores", { osm: ["shop=electronics"], g: "electronics_store", d: "medium" }],
    ["Grocery stores", { osm: ["shop=convenience", "shop=greengrocer"], g: "grocery_store" }],
    ["Supermarkets", { osm: ["shop=supermarket"], g: "supermarket", d: "medium" }],
    ["Pet stores", { osm: ["shop=pet"], g: "pet_store", d: "medium" }],
    ["Sports equipment stores", { osm: ["shop=sports"], g: "sporting_goods_store", d: "medium" }],
    ["Gift shops", { osm: ["shop=gift"], g: "gift_shop" }],
    ["Home decor stores", { osm: ["shop=interior_decoration"], g: "home_goods_store", d: "medium" }],
    ["Online retailers", { kw: ["online store", "e-shop"], d: "sparse" }],
    ["Specialty stores", { d: "medium", kw: ["specialty"] }],
  ]),
  category("Professional Services", { d: "medium" }, [
    ["Law firms", { osm: ["office=lawyer"], g: "lawyer", book: true }],
    ["Accounting firms", { osm: ["office=accountant"], g: "accounting" }],
    ["Tax consultants", { osm: ["office=tax_advisor"], kw: ["tax"] }],
    ["Financial advisory firms", { osm: ["office=financial_advisor"], g: "financial_planner" }],
    ["Insurance agencies", { osm: ["office=insurance"], g: "insurance_agency" }],
    ["Consulting firms", { osm: ["office=consulting"], kw: ["consulting"] }],
    ["Architecture firms", { osm: ["office=architect"], g: "architect", d: "sparse" }],
    ["Engineering firms", { osm: ["office=engineer"], kw: ["engineering"], d: "sparse" }],
    ["Marketing agencies", { kw: ["marketing agency", "marketing"], d: "sparse" }],
    ["Advertising agencies", { osm: ["office=advertising_agency"], d: "sparse" }],
    ["PR agencies", { kw: ["public relations", " pr "], d: "sparse" }],
    ["Recruitment agencies", { osm: ["office=employment_agency"], g: "employment_agency", d: "medium" }],
    ["HR consultancies", { kw: ["hr consult", "human resources"], d: "sparse" }],
    ["IT consulting companies", { osm: ["office=it"], kw: ["it consult", "it services"], d: "sparse" }],
    ["Business coaching firms", { kw: ["business coach"], d: "sparse" }],
  ]),
  category("Education & Training", { d: "medium" }, [
    ["Private schools", { kw: ["private school", "academy"], d: "sparse" }],
    ["Colleges", { osm: ["amenity=college"], g: "college", d: "sparse" }],
    ["Universities", { osm: ["amenity=university"], g: "university", d: "sparse" }],
    ["Training institutes", { osm: ["amenity=training"], kw: ["training"], d: "medium" }],
    ["Tutoring centers", { kw: ["tutor", "learning center"], d: "medium", book: true }],
    ["Language schools", { osm: ["amenity=language_school"], g: "language_school", d: "medium", book: true }],
    ["Coding academies", { kw: ["coding", "bootcamp"], d: "sparse" }],
    ["Online education companies", { kw: ["online learning", "e-learning"], d: "sparse" }],
    ["Music schools", { osm: ["amenity=music_school"], g: "music_school", d: "medium", book: true }],
    ["Driving schools", { osm: ["amenity=driving_school"], g: "driving_school", d: "medium", book: true }],
    ["Professional certification centers", { kw: ["certification"], d: "sparse" }],
  ]),
  category("Fitness & Sports", { d: "medium", book: true }, [
    ["Gyms", { osm: ["leisure=fitness_centre"], g: "gym", d: "dense" }],
    ["Personal training studios", { kw: ["personal training"], d: "sparse" }],
    ["Yoga studios", { kw: ["yoga"], g: "yoga_studio" }],
    ["Pilates studios", { kw: ["pilates"], d: "sparse" }],
    ["Martial arts schools", { kw: ["martial arts", "karate", "jiu", "taekwondo", "judo"], d: "sparse" }],
    ["Sports academies", { kw: ["sports academy"], d: "sparse" }],
    ["Swimming schools", { kw: ["swim school", "swimming"], d: "sparse" }],
    ["Dance studios", { osm: ["leisure=dance"], kw: ["dance"], g: "dance_school" }],
    ["CrossFit facilities", { kw: ["crossfit"], d: "sparse" }],
    ["Sports clubs", { osm: ["club=sport"], d: "medium" }],
  ]),
  category("Technology & Software", { d: "sparse" }, [
    ["Software development companies", { kw: ["software"] }],
    ["SaaS businesses", { kw: ["saas"] }],
    ["Web development agencies", { kw: ["web design", "web development"] }],
    ["Mobile app development companies", { kw: ["app development", "mobile app"] }],
    ["AI companies", { kw: [" ai ", "artificial intelligence"] }],
    ["IT service providers", { osm: ["office=it"], kw: ["it services", "it support"] }],
    ["Cybersecurity firms", { kw: ["cyber"] }],
    ["Cloud consulting companies", { kw: ["cloud consult"] }],
    ["Data analytics firms", { kw: ["analytics"] }],
    ["Digital transformation consultancies", { kw: ["digital transformation"] }],
    ["Managed service providers", { kw: ["managed service", "msp"] }],
  ]),
  category("Manufacturing & Industrial", { d: "sparse" }, [
    ["Manufacturing companies", { osm: ["man_made=works", "industrial=factory"], kw: ["manufactur"] }],
    ["Textile manufacturers", { kw: ["textile"] }],
    ["Food manufacturers", { osm: ["industrial=food"], kw: ["food processing"] }],
    ["Packaging companies", { kw: ["packaging"] }],
    ["Metal fabrication companies", { osm: ["craft=metal_construction"], kw: ["fabrication", "metalwork"] }],
    ["Machinery suppliers", { kw: ["machinery"] }],
    ["Industrial equipment dealers", { kw: ["industrial equipment"] }],
    ["Chemical manufacturers", { kw: ["chemical"] }],
    ["Wholesale distributors", { osm: ["shop=wholesale"], kw: ["distribut", "wholesale"] }],
    ["Logistics companies", { kw: ["logistics", "freight"] }],
    ["Warehousing businesses", { kw: ["warehous"] }],
  ]),
  category("Travel & Tourism", { d: "medium", book: true }, [
    ["Travel agencies", { osm: ["shop=travel_agency"], g: "travel_agency" }],
    ["Tour operators", { osm: ["office=travel_agent"], kw: ["tours"], g: "tour_operator" }],
    ["Travel consultants", { kw: ["travel consult"], d: "sparse" }],
    ["Tourist attractions", { osm: ["tourism=attraction"], g: "tourist_attraction", book: false }],
    ["Adventure tourism businesses", { kw: ["adventure"], d: "sparse" }],
    ["Car rental companies", { osm: ["amenity=car_rental"], g: "car_rental", d: "sparse" }],
    ["Airport transfer services", { kw: ["airport transfer", "airport shuttle"], d: "sparse" }],
    ["Travel accommodation providers", { osm: ["tourism=hostel", "tourism=apartment"], d: "medium" }],
  ]),
  category("Events & Entertainment", { d: "sparse", book: true }, [
    ["Wedding planners", { kw: ["wedding"], g: "wedding_planner" }],
    ["Event management companies", { kw: ["event management", "event planning"] }],
    ["Photography studios", { osm: ["craft=photographer", "shop=photo"], g: "photographer", d: "medium" }],
    ["Videography businesses", { kw: ["video production", "videograph"] }],
    ["DJs", { kw: ["dj "] }],
    ["Entertainment agencies", { kw: ["entertainment"] }],
    ["Concert venues", { osm: ["amenity=theatre", "amenity=music_venue"], g: "concert_hall" }],
    ["Party rental businesses", { kw: ["party rental"] }],
    ["Event decorators", { kw: ["decorat"] }],
  ]),
  category("Agriculture & Environment", { d: "sparse" }, [
    ["Agricultural suppliers", { osm: ["shop=agrarian"], kw: ["agricultur"] }],
    ["Farms", { osm: ["landuse=farmyard", "shop=farm"], kw: ["farm"] }],
    ["Nurseries", { osm: ["shop=garden_centre"], kw: ["nursery", "garden centre"], g: "garden_center", d: "medium" }],
    ["Landscaping suppliers", { kw: ["landscape suppl"] }],
    ["Agricultural equipment dealers", { kw: ["tractor", "farm equipment"] }],
    ["Organic food businesses", { kw: ["organic"] }],
    ["Irrigation companies", { kw: ["irrigation"] }],
    ["Environmental consulting companies", { kw: ["environmental consult"] }],
    ["Waste management companies", { kw: ["waste", "recycling"] }],
  ]),
  category("Financial & Business Services", { d: "medium" }, [
    ["Banks", { osm: ["amenity=bank"], g: "bank", d: "dense" }],
    ["Credit unions", { kw: ["credit union"], g: "credit_union" }],
    ["Accounting services", { osm: ["office=accountant"], g: "accounting" }],
    ["Bookkeeping firms", { kw: ["bookkeeping"], d: "sparse" }],
    ["Insurance brokers", { osm: ["office=insurance"], kw: ["insurance broker"] }],
    ["Payroll companies", { kw: ["payroll"], d: "sparse" }],
    ["Payment processing companies", { kw: ["payment processing", "merchant services"], d: "sparse" }],
    ["Financial technology companies", { kw: ["fintech"], d: "sparse" }],
  ]),
  category("Other Industries", { d: "medium" }, [
    ["Pet care", { osm: ["shop=pet_grooming"], kw: ["pet grooming", "pet care", "kennel", "boarding"], book: true }],
    ["Veterinary services", { osm: ["amenity=veterinary"], g: "veterinary_care", book: true }],
    ["Nonprofit organizations", { kw: ["foundation", "charity", "nonprofit"], d: "sparse" }],
    ["Religious organizations", { osm: ["amenity=place_of_worship"], g: "place_of_worship", d: "dense" }],
    ["Government contractors", { kw: ["government contract"], d: "sparse" }],
    ["Security companies", { kw: ["security"], d: "sparse" }],
    ["Wholesale businesses", { osm: ["shop=wholesale"], d: "sparse" }],
    ["Import/export businesses", { kw: ["import", "export"], d: "sparse" }],
    ["Printing companies", { osm: ["craft=printer", "shop=copyshop"], kw: ["printing"], d: "medium" }],
    ["Media companies", { osm: ["office=newspaper", "office=television"], kw: ["media"], d: "sparse" }],
    ["Publishing businesses", { kw: ["publishing", "publisher"], d: "sparse" }],
    ["Telecommunications", { osm: ["shop=mobile_phone", "office=telecommunication"], d: "medium" }],
  ]),
];

export const ALL_NICHES: Niche[] = TAXONOMY.flatMap((c) => c.niches);
const BY_ID = new Map(ALL_NICHES.map((n) => [n.id, n]));

export function getNiche(id: string): Niche | undefined {
  return BY_ID.get(id);
}

/** Build a custom niche from free text. Searched by name keyword (OSM) / text query (Google). */
export function customNiche(label: string): Niche {
  const clean = label.trim().slice(0, 80);
  return {
    id: `custom.${slug(clean)}`,
    name: clean,
    categoryId: "custom",
    category: "Custom",
    osm: [],
    kw: [clean.toLowerCase()],
    density: "medium",
    book: false,
    order: false,
    custom: true,
  };
}

/** Resolve ids (taxonomy ids or `custom.*` labels) to niches. */
export function resolveNiches(ids: string[], customLabels: string[] = []): Niche[] {
  const out: Niche[] = [];
  for (const id of ids) {
    const n = getNiche(id);
    if (n) out.push(n);
  }
  for (const l of customLabels) if (l.trim()) out.push(customNiche(l));
  return out;
}

export function searchNiches(query: string, limit = 40): Niche[] {
  const q = query.trim().toLowerCase();
  if (!q) return ALL_NICHES.slice(0, limit);
  const scored: [number, Niche][] = [];
  for (const n of ALL_NICHES) {
    const hay = `${n.name} ${n.category}`.toLowerCase();
    if (hay.includes(q)) scored.push([n.name.toLowerCase().startsWith(q) ? 0 : n.name.toLowerCase().includes(q) ? 1 : 2, n]);
  }
  return scored.sort((a, b) => a[0] - b[0]).slice(0, limit).map((s) => s[1]);
}

/** Curated "people also search these together" combinations. */
export const SUGGESTED_COMBINATIONS: { name: string; reason: string; ids: string[] }[] = [
  {
    name: "Appointment-based healthcare",
    reason: "Booking and reminder automation fits all of these.",
    ids: ["healthcare-and-medical.dental-clinics", "healthcare-and-medical.physiotherapists", "healthcare-and-medical.chiropractors"],
  },
  {
    name: "Home service contractors",
    reason: "Lead capture, quoting and scheduling gaps are common.",
    ids: ["home-services-and-contractors.plumbing-companies", "home-services-and-contractors.hvac-contractors", "home-services-and-contractors.roofing-companies"],
  },
  {
    name: "Beauty & wellness",
    reason: "Online booking and loyalty tooling.",
    ids: ["beauty-personal-care-and-wellness.hair-salons", "beauty-personal-care-and-wellness.beauty-salons", "beauty-personal-care-and-wellness.spas"],
  },
  {
    name: "Food service",
    reason: "Online ordering and reservations.",
    ids: ["food-hospitality-and-restaurants.restaurants", "food-hospitality-and-restaurants.cafes", "food-hospitality-and-restaurants.bakeries"],
  },
  {
    name: "Professional offices",
    reason: "Client intake and CRM automation.",
    ids: ["professional-services.law-firms", "professional-services.accounting-firms", "financial-and-business-services.insurance-brokers"],
  },
];
