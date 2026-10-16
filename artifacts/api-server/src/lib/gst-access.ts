import type { Request, Response, NextFunction } from "express";

// Read-only login for an outside CA / tax consultant. It sees GST invoices,
// GST purchase bills, the payments allocated against those GST invoices, and
// the GST reports — nothing else. This is a filtered VIEW only: no record is
// hidden from, altered for, or removed from the admin's complete books.
export const GST_ACCOUNTANT_ROLE = "gst_accountant";

export function isGstAccountant(req: Request): boolean {
  return (req as any).session?.role === GST_ACCOUNTANT_ROLE;
}

// The only endpoints a gst_accountant may reach (all GET). Every handler on
// this list additionally forces its own GST-only filter — the allowlist stops
// the role reaching any other module, the handler filter stops it reaching
// non-GST rows by tweaking ids/query params on an allowed endpoint.
const GST_ACCOUNTANT_ALLOWED_GETS: RegExp[] = [
  /^\/invoices$/,
  /^\/invoices\/\d+$/,
  /^\/invoices\/\d+\/payment-receipts$/,
  /^\/purchases$/,
  /^\/purchases\/report$/,
  /^\/purchases\/\d+$/,
  /^\/purchases\/\d+\/attachments$/,
  /^\/purchases\/attachments\/\d+\/file$/,
  /^\/payments$/,
  /^\/payment-receipts\/[^/]+$/,
  /^\/reports\/sales$/,
  /^\/reports\/tax$/,
  // Needed to render/print an invoice (company letterhead, print layout).
  /^\/settings$/,
  /^\/print-settings$/,
  /^\/company-profile$/,
];

// Mounted right after requireAuth: fail-closed for the gst_accountant role.
// Any write, and any read outside the allowlist, is refused server-side no
// matter what the frontend shows.
export function restrictGstAccountant(req: Request, res: Response, next: NextFunction): void {
  if (!isGstAccountant(req)) {
    next();
    return;
  }
  const path = req.path.replace(/\/+$/, "") || "/";
  if (req.method === "GET" && GST_ACCOUNTANT_ALLOWED_GETS.some((re) => re.test(path))) {
    next();
    return;
  }
  res.status(403).json({ error: "Not available for GST accountant login" });
}
