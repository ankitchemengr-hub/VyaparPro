import { useState, useEffect } from "react";

interface Company {
  id: number;
  name: string;
}

interface AuthSession {
  id: number;
  username: string;
  role: string;
  name: string;
  companyId: number | null;
  customerId: number | null;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = "/api";

async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  return res;
}

export default function App() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [companyId, setCompanyId] = useState<string>("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    apiFetch("/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setSession(data))
      .finally(() => setChecking(false));

    apiFetch("/system/companies-public")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setCompanies(Array.isArray(data) ? data : []));
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const body: Record<string, unknown> = { username, password };
      if (companyId) body.companyId = Number(companyId);
      const res = await apiFetch("/auth/login", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Login failed");
      } else {
        setSession(data);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    await apiFetch("/auth/logout", { method: "POST" });
    setSession(null);
    setUsername("");
    setPassword("");
    setCompanyId("");
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-slate-500 text-sm animate-pulse">Checking session…</div>
      </div>
    );
  }

  if (session) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg border border-slate-200 w-full max-w-md overflow-hidden">
          <div className="bg-blue-600 px-8 py-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-white font-bold text-lg">
                {(session.name || session.username).charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-white font-semibold text-lg leading-tight">
                  {session.name || session.username}
                </p>
                <p className="text-blue-200 text-sm">Logged in successfully</p>
              </div>
            </div>
          </div>

          <div className="px-8 py-6 space-y-4">
            <h2 className="text-slate-800 font-semibold text-base mb-2">Session Details</h2>
            <div className="grid grid-cols-2 gap-3">
              <InfoRow label="Username" value={session.username} />
              <InfoRow label="Role" value={roleLabel(session.role)} />
              <InfoRow
                label="Company"
                value={
                  session.companyId
                    ? companies.find((c) => c.id === session.companyId)?.name ??
                      `ID ${session.companyId}`
                    : "Super Admin"
                }
              />
              <InfoRow label="User ID" value={String(session.id)} />
            </div>

            <div className="mt-2 p-3 rounded-lg bg-green-50 border border-green-200 flex items-center gap-2">
              <span className="text-green-500 text-base">✓</span>
              <span className="text-green-700 text-sm font-medium">
                Authentication verified — per-company isolation active
              </span>
            </div>

            <button
              onClick={handleLogout}
              className="w-full mt-2 py-2.5 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg border border-slate-200 w-full max-w-md overflow-hidden">
        <div className="bg-blue-600 px-8 py-8 text-center">
          <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <h1 className="text-white font-bold text-2xl">ERP System</h1>
          <p className="text-blue-200 text-sm mt-1">Sign in to your account</p>
        </div>

        <form onSubmit={handleLogin} className="px-8 py-8 space-y-5">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Company
            </label>
            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-slate-800 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">Super Admin (no company)</option>
              {companies.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Username
            </label>
            <input
              type="text"
              required
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-slate-800 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Password
            </label>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-slate-800 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200">
              <span className="text-red-500 text-sm">✕</span>
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold rounded-lg text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>

          <div className="border-t border-slate-100 pt-4">
            <p className="text-xs text-slate-500 font-medium mb-2">Test accounts:</p>
            <div className="space-y-1.5">
              <TestHint label="Super Admin" hint='username: admin · password: admin123 · no company' onClick={() => { setUsername("admin"); setPassword("admin123"); setCompanyId(""); }} />
              <TestHint label="Company A" hint='username: admin · password: 9999 · select Test Company A' onClick={() => { setUsername("admin"); setPassword("9999"); setCompanyId(String(companies.find(c => c.name.includes("Test Company A"))?.id ?? "")); }} />
              <TestHint label="Company B" hint='username: admin · password: 456 · select Test Company B' onClick={() => { setUsername("admin"); setPassword("456"); setCompanyId(String(companies.find(c => c.name.includes("Test Company B"))?.id ?? "")); }} />
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-50 rounded-lg p-3">
      <p className="text-xs text-slate-500 mb-0.5">{label}</p>
      <p className="text-sm font-medium text-slate-800 truncate">{value}</p>
    </div>
  );
}

function TestHint({ label, hint, onClick }: { label: string; hint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left px-3 py-2 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors group"
    >
      <span className="text-xs font-medium text-blue-600 group-hover:text-blue-700">{label}</span>
      <span className="text-xs text-slate-400 ml-2">{hint}</span>
    </button>
  );
}

function roleLabel(role: string) {
  const map: Record<string, string> = {
    super_admin: "Super Admin",
    admin: "Company Admin",
    salesman: "Salesman",
    accountant: "Accountant",
    store: "Store",
    manufacturing: "Manufacturing",
    customer: "Customer",
  };
  return map[role] ?? role;
}
