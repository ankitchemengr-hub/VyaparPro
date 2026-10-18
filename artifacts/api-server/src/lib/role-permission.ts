import { pool } from "@workspace/db";

// Settings > Permissions toggles (role_permissions rows) that the app
// actually enforces. Admin always has every feature; any other role has a
// feature only when the admin switched it on for that role.
export const ROLE_FEATURES = {
  // Change the Rate field while billing (store users; admin always can).
  billingRateEdit: "billing_rate_edit",
  // Add a Material Received (manufactured goods into store) entry — add only.
  materialReceive: "material_receive",
} as const;

export async function roleAllows(companyId: number, role: string | undefined, feature: string): Promise<boolean> {
  if (role === "admin" || role === "super_admin") return true;
  if (!role) return false;
  const r = await pool.query(
    `SELECT allowed FROM role_permissions WHERE company_id = $1 AND role = $2 AND feature = $3`,
    [companyId, role, feature],
  );
  return r.rows[0]?.allowed === true;
}
