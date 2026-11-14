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
    // A platform super_admin only sees the console, never a customer's ERP.
    return roles.includes(user.role);
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
