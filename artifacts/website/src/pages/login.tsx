import { useState } from "react";
import { Link } from "wouter";
import { useLogin } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Building2 } from "lucide-react";
import { SiteFooter } from "@/components/site/site-footer";

// The customer portal reuses the ERP's own session/login (POST /auth/login)
// — a tenant's admin-role user IS the portal login, no separate identity.
export default function PortalLogin() {
  const { toast } = useToast();
  const loginMutation = useLogin();
  const { isAuthenticated, isLoading } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  if (isLoading) return null;
  if (isAuthenticated) {
    window.location.href = "/dashboard";
    return null;
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loginMutation.mutate(
      { data: { username, password, companyId: null } },
      {
        onSuccess: () => { window.location.href = "/dashboard"; },
        onError: () => toast({ title: "Login failed", description: "Invalid username or password.", variant: "destructive" }),
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
            <p className="text-sm text-slate-500 mt-1">Customer Portal Login</p>
          </div>
          <Card>
            <CardContent className="p-6">
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Email or Mobile</Label>
                  <Input value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
                </div>
                <div className="space-y-1.5">
                  <Label>Password</Label>
                  <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                </div>
                <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700" disabled={loginMutation.isPending}>
                  {loginMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Login
                </Button>
                <p className="text-center text-xs text-slate-500">
                  New here? <Link href="/register" className="text-blue-600 hover:underline">Create an account</Link>
                </p>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
