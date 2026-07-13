// Client-side fallback used when print settings cannot be loaded (e.g. the
// /print-settings request errors), so the invoice sheet still renders instead
// of spinning forever. The server is the source of truth; this is a safety net.

import type { PrintSettings } from "./types";

export const FALLBACK_PRINT_SETTINGS: PrintSettings = {
  defaultTemplate: "minimal-a5",
  copies: 1,
  copyLabels: true,
  colorMode: "color",
  paperSize: "auto",
  orientation: "auto",
  watermarkImage: null,
  showWatermark: false,
  showLogo: true,
  showQr: true,
  showBankDetails: false,
  showSignature: true,
  showAmountInWords: true,
  showHsn: true,
  showLtrColumn: true,
  showBoxColumn: true,
  showTerms: true,
  fillerRows: true,
  companyName: "",
  addressLine: "",
  contact: "",
  email: "",
  gstin: "",
  footerNote: "",
  terms: [],
  bankName: "",
  bankAccount: "",
  bankIfsc: "",
  bankBranch: "",
  upiId: "",
  qrImage: null,
  printerA4: "",
  printerA5: "",
  thermalWidth: "72mm",
};
