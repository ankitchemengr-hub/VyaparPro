// Business details shown on the Terms, Privacy Policy and Refund Policy pages
// (and required by Razorpay to match your KYC). Everything in [square
// brackets] is a placeholder — replace it with your real details before the
// site goes live. Have a CA / lawyer review the final pages once.
export const LEGAL = {
  brand: "SHRADHA ERP",
  legalName: "[Your registered business name, e.g. Shradha Enterprises]",
  address: "[Full registered address, City, State – PIN]",
  email: "[support@yourdomain.com]",
  phone: "[+91 XXXXX XXXXX]",
  gstin: "[Your GSTIN]",
  // IT Rules, 2021 — a named grievance officer who replies within the stated time.
  grievanceOfficer: "[Name of grievance officer]",
  grievanceEmail: "[grievance@yourdomain.com]",
  // Courts whose jurisdiction applies to disputes.
  jurisdictionCity: "[Your city]",
  // Bump whenever the wording of any of the three pages changes.
  lastUpdated: "16 October 2026",
} as const;

// True while any placeholder above is still unfilled — the pages show a
// visible notice so an unfinished page is never mistaken for a final one.
export const LEGAL_HAS_PLACEHOLDERS = Object.values(LEGAL).some((v) => v.startsWith("["));
