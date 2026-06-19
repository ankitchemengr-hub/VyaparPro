import React, { createContext, useContext, useEffect, useState } from "react";
import { apiFetch, apiGet, loadSession, saveSession } from "@/lib/api";

export interface User {
  id: number;
  username: string;
  role: string;
}

interface AuthSession {
  user: User;
  companyName?: string;
}

interface AuthContextType {
  user: User | null;
  companyName: string;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      await loadSession();
      try {
        const session = await apiGet<AuthSession>("/auth/me");
        if (session?.user) {
          setUser(session.user);
          setCompanyName(session.companyName ?? "");
        }
      } catch {}
      setLoading(false);
    })();
  }, []);

  const login = async (username: string, password: string) => {
    const res = await apiFetch("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as Record<string, string>;
      throw new Error(err["error"] ?? "Invalid credentials");
    }
    const session = (await res.json()) as AuthSession;
    if (session?.user) {
      setUser(session.user);
      setCompanyName(session.companyName ?? "");
    }
  };

  const logout = async () => {
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } catch {}
    await saveSession(null);
    setUser(null);
    setCompanyName("");
  };

  return (
    <AuthContext.Provider value={{ user, companyName, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
