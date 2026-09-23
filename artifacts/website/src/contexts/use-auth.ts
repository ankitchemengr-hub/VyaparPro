import { createContext, useContext } from "react";
import type { AuthSession } from "@workspace/api-client-react";

export interface AuthContextType {
  user: AuthSession | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  hasRole: (roles: AuthSession["role"][]) => boolean;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
