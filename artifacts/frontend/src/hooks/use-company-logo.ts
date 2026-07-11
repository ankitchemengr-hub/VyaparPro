import { useQuery } from "@tanstack/react-query";

interface CompanyProfile {
  id: number;
  name: string;
  logo: string | null;
}

// This company's logo (base64 data URL), for stamping onto rendered invoices.
// Managed per-tenant in Settings → Company Profile; shared cache key with
// CompanyProfilePanel so a save there refreshes every invoice preview too.
export function useCompanyLogo(): string | null {
  const { data } = useQuery<CompanyProfile>({
    queryKey: ["/api/company-profile"],
    queryFn: async () => {
      const res = await fetch("/api/company-profile", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load company profile");
      return res.json();
    },
    staleTime: 60_000,
  });
  return data?.logo ?? null;
}
