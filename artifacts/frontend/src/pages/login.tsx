import React from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/use-auth";
import {
  useLogin,
  useGetSystemConfig,
  getGetSystemConfigQueryKey,
  useGetPublicCompanies,
  getGetPublicCompaniesQueryKey,
  useSetActiveCompany,
} from "@workspace/api-client-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useToast } from "@/hooks/use-toast";
import { Factory, Check } from "lucide-react";

// Persisted login-screen company override, set via the hidden switcher. After a
// super_admin signs in, the app jumps straight into this company instead of the
// platform console.
const LOGIN_COMPANY_KEY = "login_company_override";

type LoginCompany = { id: number; name: string; logo: string | null };

function readLoginCompany(): LoginCompany | null {
  try {
    const raw = localStorage.getItem(LOGIN_COMPANY_KEY);
    return raw ? (JSON.parse(raw) as LoginCompany) : null;
  } catch {
    return null;
  }
}

const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function Login() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const loginMutation = useLogin();
  const { isAuthenticated, user, isLoading } = useAuth();
  const { data: systemConfig } = useGetSystemConfig({
    query: { retry: false, refetchOnWindowFocus: false, queryKey: getGetSystemConfigQueryKey() },
  });

  // Hidden company switcher state.
  const [switcherOpen, setSwitcherOpen] = React.useState(false);
  const [override, setOverride] = React.useState<LoginCompany | null>(() => readLoginCompany());
  const logoClicksRef = React.useRef(0);
  const logoTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const setActiveCompany = useSetActiveCompany();
  const { data: companies, isLoading: companiesLoading } = useGetPublicCompanies({
    query: {
      enabled: switcherOpen,
      retry: false,
      refetchOnWindowFocus: false,
      queryKey: getGetPublicCompaniesQueryKey(),
    },
  });

  // In dedicated single-company mode the backend returns the fixed company, so
  // the login screen shows that company's name + logo instead of generic branding.
  // A hidden switcher override (if set) takes precedence over the configured one.
  const companyName = override?.name ?? systemConfig?.company?.name ?? "Shradha Enterprises";
  const companyLogo = override?.logo ?? systemConfig?.company?.logo ?? null;

  // Hidden trigger: five quick clicks on the logo open the switcher.
  const handleLogoClick = () => {
    logoClicksRef.current += 1;
    if (logoTimerRef.current) clearTimeout(logoTimerRef.current);
    if (logoClicksRef.current >= 5) {
      logoClicksRef.current = 0;
      setSwitcherOpen(true);
      return;
    }
    logoTimerRef.current = setTimeout(() => {
      logoClicksRef.current = 0;
    }, 1500);
  };

  const selectCompany = (company: LoginCompany) => {
    setOverride(company);
    try {
      localStorage.setItem(LOGIN_COMPANY_KEY, JSON.stringify(company));
    } catch {
      /* ignore storage failures */
    }
    setSwitcherOpen(false);
    toast({
      title: "Company switched",
      description: `Sign in to continue to ${company.name}.`,
    });
  };

  const clearCompany = () => {
    setOverride(null);
    try {
      localStorage.removeItem(LOGIN_COMPANY_KEY);
    } catch {
      /* ignore storage failures */
    }
    setSwitcherOpen(false);
  };

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      username: "",
      password: "",
    },
  });

  React.useEffect(() => {
    if (isAuthenticated && user) {
      if (user.role === "super_admin") {
        setLocation("/subscriptions");
      } else if (user.role === "admin" || user.role === "accountant") {
        setLocation("/");
      } else {
        setLocation("/catalog");
      }
    }
  }, [isAuthenticated, user, setLocation]);

  if (isLoading || isAuthenticated) {
    return null;
  }

  const onSubmit = (values: LoginFormValues) => {
    loginMutation.mutate(
      { data: { ...values, companyId: override?.id ?? null } },
      {
        onSuccess: (data) => {
          // If a company was picked via the hidden switcher and this account can
          // switch (super_admin), jump straight into that company's ERP.
          if (data.role === "super_admin" && override) {
            const target = override;
            setActiveCompany.mutate(
              { data: { companyId: target.id } },
              {
                onSuccess: () => {
                  window.location.href = "/";
                },
                onError: () => {
                  // The picked company is no longer valid — drop the stale
                  // override and fall back to the platform console.
                  clearCompany();
                  toast({
                    title: "Could not switch company",
                    description: "Opening the platform console instead.",
                    variant: "destructive",
                  });
                  window.location.href = "/subscriptions";
                },
              },
            );
            return;
          }
          if (data.role === "super_admin") {
            window.location.href = "/subscriptions";
          } else if (data.role === "admin" || data.role === "accountant") {
            window.location.href = "/";
          } else {
            window.location.href = "/catalog";
          }
        },
        onError: () => {
          toast({
            title: "Login failed",
            description: "Invalid username or password.",
            variant: "destructive",
          });
        },
      }
    );
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-sidebar p-4">
      <div className="w-full max-w-md space-y-8">
        <div className="flex flex-col items-center justify-center text-center">
          <div
            onClick={handleLogoClick}
            role="presentation"
            className="cursor-default select-none"
            aria-hidden="true"
          >
            {companyLogo ? (
              <div className="w-16 h-16 rounded-xl bg-card flex items-center justify-center overflow-hidden mb-6 shadow-lg shadow-primary/20 border border-sidebar-border">
                <img src={companyLogo} alt={`${companyName} logo`} className="w-full h-full object-contain" />
              </div>
            ) : (
              <div className="w-16 h-16 rounded-xl bg-primary flex items-center justify-center text-primary-foreground mb-6 shadow-lg shadow-primary/20">
                <Factory className="w-8 h-8" />
              </div>
            )}
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-sidebar-foreground">{companyName}</h1>
          <p className="text-sidebar-foreground/60 mt-2">Vipro ERP System</p>
        </div>

        <Card className="border-sidebar-border bg-card shadow-2xl">
          <CardHeader>
            <CardTitle className="text-2xl">Sign In</CardTitle>
            <CardDescription>Enter your credentials to access the system</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Username</FormLabel>
                      <FormControl>
                        <Input placeholder="Enter your username" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="Enter your password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button 
                  type="submit" 
                  className="w-full font-bold" 
                  disabled={loginMutation.isPending}
                >
                  {loginMutation.isPending ? "Signing in..." : "Sign In"}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
        
        <div className="text-center text-sm text-sidebar-foreground/40">
          &copy; {new Date().getFullYear()} Shradha Enterprises. All rights reserved.
        </div>
      </div>

      <Dialog open={switcherOpen} onOpenChange={setSwitcherOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Switch Company</DialogTitle>
            <DialogDescription>
              Select the company you want to sign in to.
            </DialogDescription>
          </DialogHeader>
          <Command>
            <CommandInput placeholder="Search companies..." />
            <CommandList>
              {companiesLoading ? (
                <CommandEmpty>Loading companies...</CommandEmpty>
              ) : (
                <CommandEmpty>No companies found.</CommandEmpty>
              )}
              <CommandGroup>
                {companies?.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={c.name}
                    onSelect={() =>
                      selectCompany({ id: c.id, name: c.name, logo: c.logo ?? null })
                    }
                    data-testid={`company-option-${c.id}`}
                  >
                    <Check
                      className={
                        "mr-2 h-4 w-4 " +
                        (override?.id === c.id ? "opacity-100" : "opacity-0")
                      }
                    />
                    {c.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
          {override ? (
            <Button variant="outline" className="w-full" onClick={clearCompany}>
              Clear selection
            </Button>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
