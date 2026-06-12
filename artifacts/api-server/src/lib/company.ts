import { eq } from "drizzle-orm";
import { db, companiesTable, type Company } from "@workspace/db";

// Small reusable helper: load a company record by id (or null when there is no
// tenant context, e.g. platform super_admin). Centralizes the lookup so routes,
// the public /system/config endpoint, and the startup banner all read the
// company the same way — never hardcode a company id.
export async function getCurrentCompany(companyId: number | null): Promise<Company | null> {
  if (companyId == null) return null;
  const [c] = await db
    .select()
    .from(companiesTable)
    .where(eq(companiesTable.id, companyId));
  return c ?? null;
}
