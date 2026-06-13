// Sample invoice used to preview templates in the Print Settings panel, where no
// real invoice is in context. Mirrors the API invoice shape closely enough for
// every template to render representatively.

import type { ProductMaps } from "./types";

export const SAMPLE_INVOICE = {
  id: 0,
  invoiceNo: "GST/2026/0042",
  invoiceDate: new Date().toISOString(),
  invoiceType: "gst",
  status: "saved",
  placeOfSupply: "Maharashtra",
  customerName: "Demo Traders Pvt. Ltd.",
  billingAddress: "12, MIDC Industrial Area\nSolapur, Maharashtra 413006",
  customerGstin: "27ABCDE1234F1Z5",
  balanceDue: 0,
  subtotal: 11800,
  totalDiscount: 200,
  cgst: 1062,
  sgst: 1062,
  igst: 0,
  freight: 0,
  roundOff: 0,
  grandTotal: 13724,
  items: [
    {
      id: 1,
      productId: 101,
      productName: "Vipro Hydraulic Oil 68",
      hsnCode: "27101980",
      qty: 5,
      unit: "BOX",
      rate: 1200,
      taxPct: 18,
      discountPct: 0,
      discountAmt: 0,
      totalLiters: 90,
      amount: 6000,
    },
    {
      id: 2,
      productId: 102,
      productName: "Vipro Multi-Grade Engine Oil 15W40",
      hsnCode: "27101980",
      qty: 4,
      unit: "BOX",
      rate: 1450,
      taxPct: 18,
      discountPct: 5,
      discountAmt: 0,
      totalLiters: 96,
      amount: 5800,
    },
  ],
};

export const SAMPLE_MAPS: ProductMaps = {
  lpbByProduct: new Map<number, number>([
    [101, 18],
    [102, 24],
  ]),
  upbByProduct: new Map<number, number>([
    [101, 1],
    [102, 1],
  ]),
};
