---
name: Payment Receipt IDs
description: payments now use sequence-based receiptId instead of RCP-timestamp
---

# Payment Receipt ID Generation

## Change
Payment receiptId is now generated via `generateSeriesNumber(client, "payment_receipt", companyId)`.

- **Admin flow**: called inside the existing SERIALIZABLE transaction (client is already locked).
- **Salesman (pending) flow**: uses a separate `pool.connect()` + BEGIN/COMMIT just for the sequence, then releases before the db.insert().

**Why:** Sequential, human-readable receipt numbers (REC/06/1, REC/06/2…) instead of RCP-1738xxxx.

## Default format
`REC/MM/SEQ` → e.g. `REC/06/1`, `REC/06/2` (resets monthly)

## Frontend (invoice-detail.tsx)
- Fetches GET /api/number-series on dialog open to get payment_receipt config.
- Computes preview receipt number client-side from formatString + nextNumber.
- Shows preview receipt before submit, actual receipt (from response.receiptId) in success state.
- Account is required (error shown) if matchingAccounts.length > 0 and no account selected.
