import { useState } from "react";
import { Link } from "wouter";
import { useResetPortalPassword } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Building2, CheckCircle2 } from "lucide-react";
import { SiteFooter } from "@/components/site/site-footer";

export default function ResetPassword() {
  const { toast } = useToast();
  const resetPassword = useResetPortalPassword();
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }
    resetPassword.mutate(
      { data: { token, newPassword: password } },
      {
        onSuccess: () => setDone(true),
        onError: (err: any) => toast({ title: "Could not reset password", description: err?.body?.error ?? "This link may have expired.", variant: "destructive" }),
      },
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="text-center mb-6">
            <Link href="/" className="inline-flex items-center gap-2 font-bold text-xl text-slate-900">
              <Building2 className="w-7 h-7 text-blue-600" /> SHRADHA ERP
            </Link>
            <p className="text-sm text-slate-500 mt-1">Set a new password</p>
          </div>
          <Card>
            <CardContent className="p-6">
              {!token ? (
                <p className="text-sm text-red-600 text-center">This reset link is missing its token. Please use the link from your email.</p>
              ) : done ? (
                <div className="text-center space-y-3 py-4">
                  <CheckCircle2 className="w-10 h-10 text-green-600 mx-auto" />
                  <p className="text-sm text-slate-700">Your password has been reset.</p>
                  <Link href="/login"><Button className="w-full bg-blue-600 hover:bg-blue-700 mt-2">Log In</Button></Link>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>New Password</Label>
                    <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} autoFocus />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Confirm New Password</Label>
                    <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={6} />
                  </div>
                  <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700" disabled={resetPassword.isPending}>
                    {resetPassword.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Reset Password
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
