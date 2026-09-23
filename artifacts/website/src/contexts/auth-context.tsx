import React from "react";
import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";
import { AuthContext } from "./use-auth";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading } = useGetMe({
    query: { retry: false, refetchOnWindowFocus: false, queryKey: getGetMeQueryKey() },
  });

  const isAuthenticated = !!user;

  const hasRole = (roles: NonNullable<typeof user>["role"][]) => {
    if (!user) return false;
    if (roles.includes(user.role)) return true;
    // A platform super_admin that has switched into a company acts as that
    // company's admin, so it unlocks every admin-scoped page and nav item while
    // a company is selected. Without an active company it only sees the console.
    if (user.role === "super_admin" && user.activeCompanyId != null && roles.includes("admin")) {
      return true;
    }
    return false;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background text-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ user: user || null, isLoading, isAuthenticated, hasRole }}>
      {children}
    </AuthContext.Provider>
  );
}
