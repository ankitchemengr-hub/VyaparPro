---
name: Document Sequences
description: format-string based number generation for 13 document types in number_series
---

# Document Sequences Module

## DB
- `number_series` table has a new `format_string TEXT` column (nullable).
- `ALTER TABLE number_series ADD COLUMN IF NOT EXISTS format_string TEXT` was run.

## Generation modes
- **Format-string mode** (format_string IS NOT NULL): `buildFromFormatString(fmtStr, seq, date, padding)` with tokens YYYY, YY, MM, MMM, FY, SEQ.
- **Legacy structured mode** (format_string IS NULL): original `buildNumber` (prefix + year + month + paddedSeq joined by separator). Existing invoice rows use this automatically.

**Why:** Backward-compatible — existing invoices already had rows with no format_string; they keep using the old logic. New types start with format_string set.

## Series types (13 total)
invoice, order, quotation, gst_invoice, bill_of_supply, proforma_invoice, sale_return, delivery_challan, payment_receipt, sale_order, purchase_order, purchase_invoice, purchase_return

## Settings UI
- Settings → Document Sequences tab (Hash icon).
- GET /api/number-series returns all 13 types (fills defaults for missing rows).
- PUT /api/number-series/:type accepts { formatString, nextNumber, resetRule }. Also sets period_key = current period so the saved nextNumber takes effect immediately.

## Preview
- `mapSeries` in settings.ts computes preview using `buildFromFormatString(fmtStr, nextNumber, now, padding)` directly — not the reset-aware `previewNumber` (which would show startNumber when period_key is null).
