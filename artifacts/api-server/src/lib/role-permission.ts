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

// Per-user switches (User Accounts → Edit user) that grant the same features
// to one store user without turning them on for the whole role.
const USER_FEATURE_COLUMN: Record<string, string> = {
  [ROLE_FEATURES.billingRateEdit]: "can_edit_rate",
  [ROLE_FEATURES.materialReceive]: "can_receive_production",
};

// Role-level permission (Settings → Permissions) OR the user's own switch.
export async function userAllows(
  companyId: number,
  session: { role?: string; userId?: number } | null | undefined,
  feature: string,
): Promise<boolean> {
  if (await roleAllows(companyId, session?.role, feature)) return true;
  const column = USER_FEATURE_COLUMN[feature];
  if (!column || !session?.userId) return false;
  const r = await pool.query(
    `SELECT ${column} AS allowed FROM users WHERE id = $1 AND company_id = $2 AND is_active = true`,
    [session.userId, companyId],
  );
  return r.rows[0]?.allowed === true;
}

export async function roleAllows(companyId: number, role: string | undefined, feature: string): Promise<boolean> {
  if (role === "admin" || role === "super_admin") return true;
  if (!role) return false;
  const r = await pool.query(
    `SELECT allowed FROM role_permissions WHERE company_id = $1 AND role = $2 AND feature = $3`,
    [companyId, role, feature],
  );
  return r.rows[0]?.allowed === true;
}
