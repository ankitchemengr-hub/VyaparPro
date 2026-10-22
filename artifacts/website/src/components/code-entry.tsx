import { useEffect, useState } from "react";
import { customFetch, ApiError } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, MailCheck } from "lucide-react";

export function apiErrorText(err: unknown, fallback = "Something went wrong — please try again."): string {
  if (err instanceof ApiError) {
    const data = err.data as { error?: string } | null;
    if (data?.error) return data.error;
  }
  return fallback;
}

export const postJson = <T,>(url: string, body: unknown) =>
  customFetch<T>(url, { method: "POST", body: JSON.stringify(body) });

// The 6-digit emailed code step, shared by signup verification and the
// new-device login check. `verifyUrl` / `resendUrl` are the API endpoints;
// the server keeps the code itself — this only posts what the user typed.
export function CodeEntry({
  title, description, email, challengeId, verifyUrl, resendUrl, rememberOption, onVerified, onCancel,
}: {
  title: string;
  description: string;
  email: string;
  challengeId: string;
  verifyUrl: string;
  resendUrl: string;
  rememberOption?: boolean;
  onVerified: (result: unknown) => void;
  onCancel?: () => void;
}) {
  const [code, setCode] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState<"verify" | "resend" | null>(null);
  const [cooldown, setCooldown] = useState(60);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const verify = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (code.length !== 6) { setError("Enter the 6-digit code from the email."); return; }
    setBusy("verify"); setError(null); setInfo(null);
    try {
      const result = await postJson(verifyUrl, { challengeId, code, ...(rememberOption ? { rememberDevice: remember } : {}) });
      onVerified(result);
    } catch (err) {
      setError(apiErrorText(err));
      setCode("");
    } finally {
      setBusy(null);
    }
  };

  const resend = async () => {
    setBusy("resend"); setError(null); setInfo(null);
    try {
      await postJson(resendUrl, { challengeId });
      setInfo(`A new code has been sent to ${email}.`);
      setCooldown(60);
    } catch (err) {
      setError(apiErrorText(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <form onSubmit={verify} className="space-y-4">
      <div className="text-center">
        <MailCheck className="w-10 h-10 text-blue-600 mx-auto" />
        <h2 className="text-lg font-semibold mt-2">{title}</h2>
        <p className="text-sm text-slate-500 mt-1">
          {description} <span className="font-medium text-slate-700">{email}</span>
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="code">6-digit code</Label>
        <Input
          id="code"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          placeholder="••••••"
          className="text-center text-2xl tracking-[0.5em] font-mono h-12"
          data-testid="input-email-code"
        />
      </div>
      {rememberOption && (
        <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
          <Checkbox checked={remember} onCheckedChange={(v) => setRemember(v === true)} />
          Trust this device for 30 days
        </label>
      )}
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      {info && <p className="text-sm text-green-700">{info}</p>}
      <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700" disabled={busy !== null || code.length !== 6}>
        {busy === "verify" && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Verify
      </Button>
      <div className="flex items-center justify-between text-xs text-slate-500">
        <button
          type="button"
          onClick={resend}
          disabled={busy !== null || cooldown > 0}
          className="text-blue-600 hover:underline disabled:text-slate-400 disabled:no-underline"
        >
          {busy === "resend" ? "Sending…" : cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
        </button>
        {onCancel && <button type="button" onClick={onCancel} className="hover:underline">Back</button>}
      </div>
      <p className="text-xs text-slate-400 text-center">Can't find it? Check your Spam / Promotions folder. The code expires in 10 minutes.</p>
    </form>
  );
}
