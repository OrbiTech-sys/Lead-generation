import type { LeadFacts, Opportunity } from "./types";

/**
 * Rule-based digital-opportunity detection. Every opportunity states HOW certain it is:
 *  verified      we directly measured / observed it (unreachable site, no HTTPS, slow response)
 *  detected      positive signal found (outdated copyright, broken links)
 *  not_detected  we looked and did not see the feature — NOT proof it is missing
 *  needs_review  cannot be judged automatically (e.g. mobile usability)
 */
export function detectOpportunities(f: LeadFacts, now = new Date()): Opportunity[] {
  const out: Opportunity[] = [];
  const a = f.websiteAudit;
  const hasWebsite = !!f.website?.trim();
  const reachable = a?.reachable === "detected";
  const sourcesText = f.sources.join(", ") || "the sources searched";

  if (!hasWebsite) {
    out.push({
      key: "no_website",
      label: "No website listed",
      service: "Website design & development",
      certainty: "not_detected",
      detail: `No website appears in ${sourcesText}. The business may have one that isn't listed — confirm manually before outreach.`,
    });
  } else if (a) {
    if (a.reachable === "verified_absent") {
      out.push({
        key: "website_unreachable",
        label: "Website unreachable",
        service: "Website recovery / hosting",
        certainty: "verified",
        detail: a.error ?? "The listed website could not be reached when checked.",
      });
    }
    if (a.https === "verified_absent") {
      out.push({
        key: "no_ssl",
        label: "No valid HTTPS / SSL",
        service: "Website security (SSL) setup",
        certainty: "verified",
        detail: a.httpsNote ?? "Site is served without valid HTTPS.",
      });
    }
    if (reachable) {
      if (a.responseMs && a.responseMs > 3000) {
        out.push({
          key: "slow_site",
          label: "Slow website response",
          service: "Website performance optimisation",
          certainty: "verified",
          detail: `Homepage took ${(a.responseMs / 1000).toFixed(1)}s to load from our server (single measurement).`,
        });
      }
      if (a.signals.viewport === "not_detected") {
        out.push({
          key: "mobile_unfriendly",
          label: "Possible poor mobile usability",
          service: "Responsive redesign",
          certainty: "needs_review",
          detail: "No responsive viewport meta tag found. Open the site on a phone to confirm.",
        });
      }
      if (a.brokenLinks.broken.length > 0) {
        out.push({
          key: "broken_links",
          label: "Broken links",
          service: "Website maintenance",
          certainty: "detected",
          detail: `${a.brokenLinks.broken.length} of ${a.brokenLinks.checked} sampled internal links failed (e.g. ${a.brokenLinks.broken[0]}).`,
        });
      }
      const year = a.signals.copyrightYear;
      if ((year && year <= now.getFullYear() - 3) || a.signals.legacyMarkup === "detected") {
        out.push({
          key: "outdated_site",
          label: "Website looks outdated",
          service: "Website redesign",
          certainty: "detected",
          detail: [year && year <= now.getFullYear() - 3 ? `Footer copyright year is ${year}.` : "", a.signals.legacyMarkup === "detected" ? "Uses legacy HTML/Flash markup." : ""]
            .filter(Boolean)
            .join(" "),
        });
      }
      if (f.nicheBook && a.signals.booking === "not_detected") {
        out.push({
          key: "no_online_booking",
          label: "No online booking detected",
          service: "Appointment / booking automation",
          certainty: "not_detected",
          detail: "No booking widget or booking-related link found on the homepage or contact page. May exist elsewhere.",
        });
      }
      if (f.nicheOrder && a.signals.onlineOrdering === "not_detected") {
        out.push({
          key: "no_online_ordering",
          label: "No online ordering detected",
          service: "Online ordering / e-commerce",
          certainty: "not_detected",
          detail: "No ordering or cart functionality found on the pages checked.",
        });
      }
      if (a.signals.chat === "not_detected") {
        out.push({
          key: "no_chatbot",
          label: "No chat / support widget detected",
          service: "AI chatbot / customer support automation",
          certainty: "not_detected",
          detail: "No live-chat or chatbot script found in the page source.",
        });
      }
      if (a.signals.contactForm === "not_detected") {
        out.push({
          key: "no_contact_form",
          label: "No contact form detected",
          service: "Lead capture forms",
          certainty: "not_detected",
          detail: "No enquiry form found on the homepage or contact page.",
        });
      }
      if (a.signals.crmOrMarketing === "not_detected") {
        out.push({
          key: "no_crm_automation",
          label: "No CRM / marketing automation detected",
          service: "CRM & workflow automation",
          certainty: "not_detected",
          detail: "No CRM, email-marketing or automation script found in the page source.",
        });
      }
    }
  }

  const channels = [f.phone, f.email, f.website, f.facebook, f.instagram, f.linkedin].filter((x) => !!x).length;
  if (channels <= 2) {
    out.push({
      key: "limited_presence",
      label: "Limited digital presence",
      service: "Digital presence setup",
      certainty: "not_detected",
      detail: `Only ${channels} public contact/presence channel(s) found across ${sourcesText}.`,
    });
  }
  const missing = [!f.phone && "phone", !f.address && "address", !f.openingHours && "opening hours"].filter(Boolean);
  if (missing.length) {
    out.push({
      key: "incomplete_info",
      label: "Incomplete business information",
      service: "Local listing optimisation",
      certainty: "not_detected",
      detail: `Missing in sources: ${missing.join(", ")}.`,
    });
  }
  return out;
}

export const CERTAINTY_WEIGHT = { verified: 1, detected: 0.7, needs_review: 0.4, not_detected: 0.3 } as const;
