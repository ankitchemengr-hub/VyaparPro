import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMeQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CodeEntry, apiErrorText, postJson } from "@/components/code-entry";
import { KeyRound, Mail, Loader2, LogOut, ShieldCheck } from "lucide-react";

const MIN_PASSWORD = 8;

// Every signed-in user: change your own password (current password required).
function ChangePasswordCard() {
  const { toast } = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next.length < MIN_PASSWORD) return setError(`New password must be at least ${MIN_PASSWORD} characters.`);
    if (next !== confirm) return setError("New passwords don't match.");
    setBusy(true);
    try {
      await postJson("/api/auth/change-password", { currentPassword: current, newPassword: next });
      setCurrent(""); setNext(""); setConfirm("");
      toast({ title: "Password changed", description: "Use the new password next time you log in." });
    } catch (err) {
      setError(apiErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><KeyRound className="w-4 h-4" /> Change password</CardTitle>
        <CardDescription>At least {MIN_PASSWORD} characters. Other devices you trusted will need a login code again.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3 max-w-sm">
          <div className="space-y-1.5">
            <Label htmlFor="cur-pw">Current password</Label>
            <Input id="cur-pw" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-pw">New password</Label>
            <Input id="new-pw" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={MIN_PASSWORD} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-pw2">Confirm new password</Label>
            <Input id="new-pw2" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <Button type="submit" disabled={busy}>
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Change password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// Company admin whose login is an email: move it to a new address, confirmed
// by a code sent to that new address.
function ChangeEmailCard({ currentEmail }: { currentEmail: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<{ challengeId: string; email: string } | null>(null);

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await postJson<{ challengeId: string; email: string }>("/api/auth/change-email", { newEmail, password });
      setChallenge(r);
      setPassword("");
    } catch (err) {
      setError(apiErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Mail className="w-4 h-4" /> Login email</CardTitle>
        <CardDescription>
          You log in with <span className="font-medium text-foreground">{currentEmail}</span>. Invoices and reminders go here too.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {challenge ? (
          <div className="max-w-sm">
            <CodeEntry
              title="Confirm your new email"
              description="We sent a 6-digit code to"
              email={challenge.email}
              challengeId={challenge.challengeId}
              verifyUrl="/api/auth/change-email/verify"
              resendUrl="/api/auth/change-email/resend"
              onVerified={() => {
                setChallenge(null);
                setNewEmail("");
                queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
                toast({ title: "Login email changed", description: "Use the new email next time you log in." });
              }}
              onCancel={() => setChallenge(null)}
            />
          </div>
        ) : (
          <form onSubmit={start} className="space-y-3 max-w-sm">
            <div className="space-y-1.5">
              <Label htmlFor="new-email">New email</Label>
              <Input id="new-email" type="email" autoComplete="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email-pw">Your password</Label>
              <Input id="email-pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Send code to new email
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

// Email login code (2-step sign-in) for accounts whose login isn't an email:
// add an email, confirm it with a code, and from then on a new device needs
// the code sent there. Website signups already have it on (can't turn off).
interface LoginCodeStatus { enabled: boolean; email: string | null; canTurnOff: boolean }

function LoginCodeCard() {
  const { toast } = useToast();
  const [status, setStatus] = useState<LoginCodeStatus | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<{ challengeId: string; email: string } | null>(null);
  const [turningOff, setTurningOff] = useState(false);

  const load = () =>
    fetch("/api/auth/login-code", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => s && setStatus(s))
      .catch(() => {});
  useEffect(() => { load(); }, []);

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await postJson<{ challengeId: string; email: string }>("/api/auth/login-code", { email, password });
      setChallenge(r);
      setPassword("");
    } catch (err) {
      setError(apiErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await postJson("/api/auth/login-code/disable", { password });
      setPassword("");
      setTurningOff(false);
      toast({ title: "Login codes turned off" });
      load();
    } catch (err) {
      setError(apiErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (!status) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="w-4 h-4" /> Login code on new devices
          <span className={`ml-1 text-xs font-semibold rounded px-1.5 py-0.5 ${status.enabled ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`}>
            {status.enabled ? "ON" : "OFF"}
          </span>
        </CardTitle>
        <CardDescription>
          {status.enabled
            ? <>Signing in from a new phone or computer needs a 6-digit code sent to <span className="font-medium text-foreground">{status.email}</span>, so a stolen password alone isn't enough.</>
            : "Add an email: signing in from a new phone or computer will then need a 6-digit code sent there, so a stolen password alone isn't enough. Your username stays the same."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {challenge ? (
          <div className="max-w-sm">
            <CodeEntry
              title="Confirm your email"
              description="We sent a 6-digit code to"
              email={challenge.email}
              challengeId={challenge.challengeId}
              verifyUrl="/api/auth/login-code/verify"
              resendUrl="/api/auth/login-code/resend"
              onVerified={() => {
                setChallenge(null);
                setEmail("");
                toast({ title: "Login codes are on", description: "This device is remembered; new devices will need a code." });
                load();
              }}
              onCancel={() => setChallenge(null)}
            />
          </div>
        ) : status.enabled ? (
          status.canTurnOff && (
            turningOff ? (
              <form onSubmit={turnOff} className="space-y-3 max-w-sm">
                <div className="space-y-1.5">
                  <Label htmlFor="otp-off-pw">Your password</Label>
                  <Input id="otp-off-pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                </div>
                {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
                <div className="flex gap-2">
                  <Button type="submit" variant="destructive" disabled={busy}>
                    {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Turn off
                  </Button>
                  <Button type="button" variant="outline" onClick={() => { setTurningOff(false); setError(null); }}>Cancel</Button>
                </div>
              </form>
            ) : (
              <Button variant="outline" onClick={() => setTurningOff(true)} data-testid="button-otp-off">Turn off login codes</Button>
            )
          )
        ) : (
          <form onSubmit={start} className="space-y-3 max-w-sm">
            <div className="space-y-1.5">
              <Label htmlFor="otp-email">Email for login codes</Label>
              <Input id="otp-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="otp-pw">Your password</Label>
              <Input id="otp-pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
            <Button type="submit" disabled={busy} data-testid="button-otp-on">
              {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Send code and turn on
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

// Lost phone, shared computer: end every other sign-in of this account.
function SignOutEverywhereCard() {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!window.confirm("Sign out of all other devices? This one stays signed in.")) return;
    setBusy(true);
    try {
      await postJson("/api/auth/logout-all", {});
      toast({ title: "Signed out of all other devices" });
    } catch (err) {
      toast({ title: "Could not sign out other devices", description: apiErrorText(err), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><LogOut className="w-4 h-4" /> Other devices</CardTitle>
        <CardDescription>
          Signed in on a phone or computer you no longer use? Sign out everywhere else. Changing your password does this too.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" onClick={run} disabled={busy} data-testid="button-logout-all">
          {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Sign out of all other devices
        </Button>
      </CardContent>
    </Card>
  );
}

export default function MyAccount() {
  const { user } = useAuth();
  if (!user) return null;
  const canChangeEmail = user.role === "admin" && user.username.includes("@");
  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">My Account</h1>
        <p className="text-muted-foreground">
          {user.name} · <span className="font-mono">{user.username}</span> · <span className="capitalize">{user.role}</span>
        </p>
      </div>
      <ChangePasswordCard />
      <LoginCodeCard />
      <SignOutEverywhereCard />
      {canChangeEmail && <ChangeEmailCard currentEmail={user.username} />}
    </div>
  );
}
