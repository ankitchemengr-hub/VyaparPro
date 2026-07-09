import React, { createContext, useContext, useEffect, useState } from "react";
import { apiFetch, apiGet, loadSession, saveSession } from "@/lib/api";

export interface User {
  id: number;
  username: string;
  role: string;
}

interface CompanyBranding {
  name: string;
  logo: string | null;
}

// /auth/login and /auth/me both respond with the flat user fields plus a
// `company` object — not a wrapped { user, companyName } session. Keep this
// shape in sync with artifacts/api-server/src/routes/auth.ts.
interface AuthSession extends User {
  company?: CompanyBranding | null;
}

interface AuthContextType {
  user: User | null;
  companyName: string;
  companyLogo: string | null;
  loading: boolean;
  login: (username: string, password: string, companyId?: number | null) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [companyLogo, setCompanyLogo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const applySession = (session: AuthSession | null) => {
    if (!session?.id) return;
    setUser({ id: session.id, username: session.username, role: session.role });
    setCompanyName(session.company?.name ?? "");
    setCompanyLogo(session.company?.logo ?? null);
  };

  useEffect(() => {
    (async () => {
      await loadSession();
      try {
        const session = await apiGet<AuthSession>("/auth/me");
        applySession(session);
      } catch {}
      setLoading(false);
    })();
  }, []);

  const login = async (username: string, password: string, companyId?: number | null) => {
    const body: Record<string, unknown> = { username, password };
    if (companyId != null) body.companyId = companyId;
    const res = await apiFetch("/auth/login", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as Record<string, string>;
      throw new Error(err["error"] ?? "Invalid credentials");
    }
    const session = (await res.json()) as AuthSession;
    applySession(session);
  };

  const logout = async () => {
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } catch {}
    await saveSession(null);
    setUser(null);
    setCompanyName("");
    setCompanyLogo(null);
  };

  return (
    <AuthContext.Provider value={{ user, companyName, companyLogo, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
