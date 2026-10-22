import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMeQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CodeEntry, apiErrorText, postJson } from "@/components/code-entry";
import { KeyRound, Mail, Loader2 } from "lucide-react";

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
      {canChangeEmail && <ChangeEmailCard currentEmail={user.username} />}
    </div>
  );
}
