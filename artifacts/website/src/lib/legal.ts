// Business details shown on the Terms, Privacy Policy and Refund Policy pages
// (and required by Razorpay to match your KYC). Everything in [square
// brackets] is a placeholder — replace it with your real details before the
// site goes live. Have a CA / lawyer review the final pages once.
export const LEGAL = {
  brand: "SHRADHA ERP",
  legalName: "Yash Enterprises",
  address: "03, Ganesh Nagar, Bale, Solapur – 413255, Maharashtra",
  email: "support@shradhaerp.com",
  phone: "+91 98607 99449",
  // Digits only, with country code — for tel: and WhatsApp links.
  phoneDigits: "919860799449",
  gstin: "27BFTPC0657J1Z5",
  // IT Rules, 2021 — a named grievance officer who replies within the stated time.
  grievanceOfficer: "Ankit Chourasiya",
  grievanceEmail: "support@shradhaerp.com",
  // Courts whose jurisdiction applies to disputes.
  jurisdictionCity: "Solapur",
  // Bump whenever the wording of any of the three pages changes.
  lastUpdated: "16 October 2026",
} as const;

// True while any placeholder above is still unfilled — the pages show a
// visible notice so an unfinished page is never mistaken for a final one.
export const LEGAL_HAS_PLACEHOLDERS = Object.values(LEGAL).some((v) => v.startsWith("["));
