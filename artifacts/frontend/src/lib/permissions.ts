import { useGetRolePermissions, getGetRolePermissionsQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/use-auth";

// Settings > Permissions toggles that the app enforces (server checks the
// same rows — see api-server lib/role-permission.ts).
export const FEATURE_BILLING_RATE_EDIT = "billing_rate_edit";
export const FEATURE_MATERIAL_RECEIVE = "material_receive";

// Returns a checker: does the logged-in user's role have `feature`?
// Admin (and super_admin inside a company) always does.
export function useRoleFeature(): (feature: string) => boolean {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";
  const { data } = useGetRolePermissions({
    query: { queryKey: getGetRolePermissionsQueryKey(), enabled: !!user && !isAdmin, staleTime: 60_000 },
  });
  return (feature: string) => {
    if (!user) return false;
    if (isAdmin) return true;
    // Per-user switches from User Accounts (returned on /auth/me).
    if (feature === FEATURE_MATERIAL_RECEIVE && (user as any).canReceiveProduction === true) return true;
    if (feature === FEATURE_BILLING_RATE_EDIT && (user as any).canEditRate === true) return true;
    return (data ?? []).some((p) => p.role === user.role && p.feature === feature && p.allowed);
  };
}
