import { useState } from "react";
import { Link } from "wouter";
import { useForgotPortalPassword } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Building2, CheckCircle2 } from "lucide-react";
import { SiteFooter } from "@/components/site/site-footer";

export default function ForgotPassword() {
  const forgotPassword = useForgotPortalPassword();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    forgotPassword.mutate({ data: { email } }, { onSuccess: () => setSent(true) });
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="text-center mb-6">
            <Link href="/" className="inline-flex items-center gap-2 font-bold text-xl text-slate-900">
              <Building2 className="w-7 h-7 text-blue-600" /> SHRADHA ERP
            </Link>
            <p className="text-sm text-slate-500 mt-1">Reset your password</p>
          </div>
          <Card>
            <CardContent className="p-6">
              {sent ? (
                <div className="text-center space-y-3 py-4">
                  <CheckCircle2 className="w-10 h-10 text-green-600 mx-auto" />
                  <p className="text-sm text-slate-700">If that email is registered with us, a password reset link has been sent. Check your inbox (and spam folder).</p>
                  <Link href="/login" className="text-blue-600 hover:underline text-sm">Back to Login</Link>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>Registered Email</Label>
                    <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus placeholder="you@business.com" />
                  </div>
                  <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700" disabled={forgotPassword.isPending}>
                    {forgotPassword.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Send Reset Link
                  </Button>
                  <p className="text-center text-xs text-slate-500">
                    <Link href="/login" className="text-blue-600 hover:underline">Back to Login</Link>
                  </p>
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
