import { useState, useEffect, useRef } from "react";

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

const API = "/api";
const LS_COMPANY_KEY = "erp_last_company_id";

async function apiFetch(path: string, options?: RequestInit) {
  return fetch(`${API}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
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

  // ── Hidden 5-tap company selector ──────────────────────────────────────────
  const [showCompanySelector, setShowCompanySelector] = useState(false);
  const [logoTapCount, setLogoTapCount] = useState(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // On mount: check session + load company list
  useEffect(() => {
    apiFetch("/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setSession(data))
      .finally(() => setChecking(false));

    apiFetch("/system/companies-public")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setCompanies(Array.isArray(data) ? data : []));
  }, []);

  // When company selector becomes visible, restore last-used company from localStorage
  useEffect(() => {
    if (showCompanySelector) {
      const saved = localStorage.getItem(LS_COMPANY_KEY);
      if (saved) setCompanyId(saved);
    }
  }, [showCompanySelector]);

  // Persist selected company whenever it changes
  useEffect(() => {
    if (companyId) {
      localStorage.setItem(LS_COMPANY_KEY, companyId);
    } else {
      localStorage.removeItem(LS_COMPANY_KEY);
    }
  }, [companyId]);

  // 5-tap handler on the logo / header area
  function handleLogoTap() {
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current);

    const next = logoTapCount + 1;
    if (next >= 5) {
      setLogoTapCount(0);
      setShowCompanySelector(true);
      // Restore last company immediately
      const saved = localStorage.getItem(LS_COMPANY_KEY);
      if (saved) setCompanyId(saved);
    } else {
      setLogoTapCount(next);
      // Reset counter if no additional tap within 2 s
      tapTimerRef.current = setTimeout(() => setLogoTapCount(0), 2000);
    }
  }

  // Fill credentials and, if a company hint is provided, reveal selector too
  function fillCredentials(
    u: string,
    p: string,
    cid?: string,
  ) {
    setUsername(u);
    setPassword(p);
    if (cid !== undefined) {
      setShowCompanySelector(true);
      setCompanyId(cid);
      if (cid) localStorage.setItem(LS_COMPANY_KEY, cid);
    } else {
      // Super Admin — hide selector, clear company
      setShowCompanySelector(false);
      setCompanyId("");
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const body: Record<string, unknown> = { username, password };
      if (showCompanySelector && companyId) {
        body.companyId = Number(companyId);
      }
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
  }

  // ── Loading splash ──────────────────────────────────────────────────────────
  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-slate-400 text-sm animate-pulse">Checking session…</div>
      </div>
    );
  }

  // ── Authenticated view ──────────────────────────────────────────────────────
  if (session) {
    const companyName = session.companyId
      ? (companies.find((c) => c.id === session.companyId)?.name ?? `Company #${session.companyId}`)
      : "Super Admin";

    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg border border-slate-200 w-full max-w-md overflow-hidden">
          <div className="bg-blue-600 px-8 py-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-white font-bold text-lg select-none">
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
            <h2 className="text-slate-800 font-semibold text-base">Session Details</h2>
            <div className="grid grid-cols-2 gap-3">
              <InfoRow label="Username" value={session.username} />
              <InfoRow label="Role" value={roleLabel(session.role)} />
              <InfoRow label="Company" value={companyName} />
              <InfoRow label="User ID" value={String(session.id)} />
            </div>

            <div className="p-3 rounded-lg bg-green-50 border border-green-200 flex items-center gap-2">
              <span className="text-green-500">✓</span>
              <span className="text-green-700 text-sm font-medium">
                Authentication verified — per-company isolation active
              </span>
            </div>

            <button
              onClick={handleLogout}
              className="w-full py-2.5 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Login form ──────────────────────────────────────────────────────────────
  const tapHintsLeft = 5 - logoTapCount;
  const showTapHint = logoTapCount > 0 && logoTapCount < 5;

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg border border-slate-200 w-full max-w-md overflow-hidden">

        {/* Header — tap 5 times to reveal company selector */}
        <div
          className="bg-blue-600 px-8 py-8 text-center cursor-default select-none"
          onClick={handleLogoTap}
        >
          <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <h1 className="text-white font-bold text-2xl">ERP System</h1>
          <p className="text-blue-200 text-sm mt-1">
            {showTapHint
              ? `${tapHintsLeft} more tap${tapHintsLeft === 1 ? "" : "s"}…`
              : "Sign in to your account"}
          </p>
        </div>

        <form onSubmit={handleLogin} className="px-8 py-8 space-y-5">

          {/* Company selector — hidden until 5 taps */}
          {showCompanySelector && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-sm font-medium text-slate-700">Company</label>
                <button
                  type="button"
                  onClick={() => { setShowCompanySelector(false); setCompanyId(""); }}
                  className="text-xs text-slate-400 hover:text-slate-600"
                >
                  Hide
                </button>
              </div>
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
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Username</label>
            <input
              type="text"
              required
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-slate-800 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Password</label>
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

          {/* Quick-fill test hints */}
          <div className="border-t border-slate-100 pt-4">
            <p className="text-xs text-slate-400 mb-2">Quick fill (testing):</p>
            <div className="space-y-1.5">
              <QuickFill
                label="Super Admin"
                hint="admin · admin123"
                onClick={() => fillCredentials("admin", "admin123")}
              />
              <QuickFill
                label="Company A"
                hint="admin · 9999"
                onClick={() => {
                  const cid = companies.find((c) => c.name.includes("Test Company A"))?.id;
                  fillCredentials("admin", "9999", cid ? String(cid) : "");
                }}
              />
              <QuickFill
                label="Company B"
                hint="admin · 456"
                onClick={() => {
                  const cid = companies.find((c) => c.name.includes("Test Company B"))?.id;
                  fillCredentials("admin", "456", cid ? String(cid) : "");
                }}
              />
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

function QuickFill({ label, hint, onClick }: { label: string; hint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left px-3 py-2 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors group"
    >
      <span className="text-xs font-medium text-blue-600">{label}</span>
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
