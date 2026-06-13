import { useGetCompanies, useSetActiveCompany } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Building2, ChevronsUpDown } from "lucide-react";
import { useAuth } from "@/contexts/use-auth";

// Lets the platform super_admin switch into a tenant company (or back to the
// platform console). The selection is persisted server-side on the session
// cookie; every company-scoped API reads it, so changing it re-scopes all data.
// Rendered only for super_admin — regular users are locked to their own company.
export function CompanySwitcher() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { data: companies } = useGetCompanies();
  const setActiveCompany = useSetActiveCompany();

  if (!user || user.role !== "super_admin") return null;

  const current = user.activeCompanyId ?? "";

  const handleChange = (value: string) => {
    const companyId = value === "" ? null : Number(value);
    setActiveCompany.mutate(
      { data: { companyId } },
      {
        onSuccess: () => {
          // The active company drives every cached query, so drop them all and
          // refetch fresh data (including /auth/me) for the new context.
          queryClient.invalidateQueries();
          navigate(companyId == null ? "/subscriptions" : "/");
        },
      },
    );
  };

  return (
    <div className="relative flex items-center">
      <Building2 className="pointer-events-none absolute left-2 h-4 w-4 text-muted-foreground" />
      <select
        aria-label="Active company"
        data-testid="select-active-company"
        value={current}
        disabled={setActiveCompany.isPending}
        onChange={(e) => handleChange(e.target.value)}
        className="h-8 appearance-none rounded-md border bg-background pl-7 pr-7 text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
      >
        <option value="">Platform Console</option>
        {companies?.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <ChevronsUpDown className="pointer-events-none absolute right-2 h-3.5 w-3.5 text-muted-foreground" />
    </div>
  );
}
