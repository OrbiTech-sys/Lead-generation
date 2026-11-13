import type { Opportunity } from "../scoring/types";

export interface OutreachInput {
  businessName: string;
  city?: string | null;
  subcategory?: string | null;
  website?: string | null;
  description?: string | null;
  opportunities: Opportunity[];
  sender: { name: string; company: string; website?: string; phone?: string; address?: string };
}

export interface OutreachDraft {
  channel: "email" | "sms" | "call";
  subject?: string;
  body: string;
  /** What the draft is grounded on, so the sender can verify before sending. */
  basis: string[];
  warnings: string[];
}

const ORDER = { verified: 0, detected: 1, needs_review: 2, not_detected: 3 } as const;

/** Pick the strongest, most outreach-worthy opportunity (verified > detected > ...), skipping vague ones. */
export function topOpportunity(opps: Opportunity[]): Opportunity | null {
  const usable = opps.filter((o) => !["limited_presence", "incomplete_info"].includes(o.key));
  return [...usable].sort((a, b) => ORDER[a.certainty] - ORDER[b.certainty])[0] ?? null;
}

/** Phrase an observation honestly: state facts we verified; hedge what we merely did not detect. */
function observation(o: Opportunity, site?: string | null): string {
  const s = site ? ` on ${site.replace(/^https?:\/\//, "").replace(/\/$/, "")}` : "";
  switch (o.key) {
    case "no_website": return "I couldn't find a website listed for you online";
    case "website_unreachable": return `your website${s} didn't load when I tried to visit it`;
    case "no_ssl": return `your website${s} isn't served over a secure (HTTPS) connection, so browsers may show visitors a warning`;
    case "slow_site": return `your website${s} was slow to load when I checked`;
    case "mobile_unfriendly": return `your website${s} may not be optimised for phones (worth double-checking)`;
    case "broken_links": return `a few links${s} appear to be broken`;
    case "outdated_site": return `your website${s} looks like it hasn't been refreshed in a while`;
    case "no_online_booking": return `I didn't see an online booking option${s}`;
    case "no_online_ordering": return `I didn't see online ordering${s}`;
    case "no_chatbot": return `I didn't notice a live chat or automated enquiry assistant${s}`;
    case "no_contact_form": return `I couldn't find an enquiry form${s}`;
    case "no_crm_automation": return `I didn't see any follow-up automation${s}`;
    default: return o.label.toLowerCase();
  }
}

const SERVICE_BENEFIT: Record<string, string> = {
  "Website design & development": "a fast, modern website that turns local searches into enquiries",
  "Website recovery / hosting": "getting your site back online and reliably hosted",
  "Website security (SSL) setup": "securing your site with HTTPS (usually a quick fix)",
  "Website performance optimisation": "speeding your site up so fewer visitors leave",
  "Responsive redesign": "making the site work smoothly on mobile",
  "Website maintenance": "fixing the broken pages and keeping the site healthy",
  "Website redesign": "a refreshed site that reflects the quality of your business",
  "Appointment / booking automation": "online booking with automatic reminders, so fewer calls and no-shows",
  "Online ordering / e-commerce": "online ordering so customers can buy without picking up the phone",
  "AI chatbot / customer support automation": "an assistant that answers common questions and captures enquiries after hours",
  "Lead capture forms": "a simple enquiry form that sends leads straight to you",
  "CRM & workflow automation": "automatic follow-ups so no enquiry slips through",
};

export function generateOutreach(input: OutreachInput): OutreachDraft[] {
  const { businessName: biz, sender } = input;
  const opp = topOpportunity(input.opportunities);
  const place = input.city ? ` in ${input.city}` : "";
  const what = input.subcategory ? input.subcategory.toLowerCase() : "business";
  const benefit = opp ? SERVICE_BENEFIT[opp.service] ?? opp.service.toLowerCase() : "growing your online presence";
  const obs = opp ? observation(opp, input.website) : `I came across ${biz}${place}`;
  const hedge = opp && (opp.certainty === "not_detected" || opp.certainty === "needs_review");
  const basis = opp ? [`${opp.label} — ${opp.certainty.replace("_", " ")}: ${opp.detail}`] : ["No specific gap identified; generic introduction."];
  const warnings: string[] = [];
  if (hedge) warnings.push("This observation is based on what automated checks did not detect. Verify it manually before sending.");
  const footer = [sender.company, sender.address, sender.website].filter(Boolean).join(" · ");

  const email: OutreachDraft = {
    channel: "email",
    subject: opp ? `Quick idea for ${biz}` : `Hello from ${sender.company}`,
    body:
      `Hi ${biz} team,\n\n` +
      `I'm ${sender.name} from ${sender.company}. While looking at ${what} businesses${place}, ${obs}${hedge ? " — though I may have missed it" : ""}.\n\n` +
      `We help businesses like yours with ${benefit}. If that's something you've been meaning to sort out, I'd be happy to share a couple of specific ideas — no obligation.\n\n` +
      `Would a short call this week work?\n\nBest regards,\n${sender.name}\n${footer}\n\n` +
      `If you'd rather not hear from us, reply "unsubscribe" and we won't contact you again.`,
    basis,
    warnings: [
      ...warnings,
      "Commercial email must include your real postal address and a working opt-out (CAN-SPAM) and may require prior consent in some regions (GDPR/PECR, CASL). Check your lead's country.",
      ...(sender.address ? [] : ["Add your business postal address in the footer before sending."]),
    ],
  };
  const sms: OutreachDraft = {
    channel: "sms",
    body: `Hi, this is ${sender.name} from ${sender.company}. ${obs.charAt(0).toUpperCase() + obs.slice(1)}${hedge ? " (I may have missed it)" : ""}. We can help with ${benefit}. Interested in a quick chat? Reply STOP to opt out.`,
    basis,
    warnings: [...warnings, "Do not send marketing SMS without the recipient's prior consent (TCPA, PECR, etc.). Use only with opted-in or existing-relationship contacts."],
  };
  const call: OutreachDraft = {
    channel: "call",
    body:
      `Opening: "Hi, is this ${biz}? My name is ${sender.name} from ${sender.company}. I'll be brief — ${obs}${hedge ? ", though I could be wrong" : ""}. ` +
      `We help ${what} businesses with ${benefit}. Is that something worth a 5-minute conversation?"\n\n` +
      `If not interested: "No problem at all — thanks for your time. Should I note that you'd prefer we don't call again?"\n` +
      `Always: record the outcome in the CRM and honour any do-not-call request immediately.`,
    basis,
    warnings: [...warnings, "Check national do-not-call registries before cold calling, and call only in permitted hours."],
  };
  return [email, sms, call];
}
