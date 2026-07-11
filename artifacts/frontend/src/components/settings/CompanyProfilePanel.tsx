// Per-company branding: lets each tenant's admin set their own logo, shown
// on the login screen and company switcher. API is admin-only on PUT.

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Upload, X, Building2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface CompanyProfile {
  id: number;
  name: string;
  logo: string | null;
}

const MAX_LOGO_BYTES = 500 * 1024;
const COMPANY_PROFILE_KEY = ["/api/company-profile"];

export function CompanyProfilePanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: profile, isLoading: loading } = useQuery<CompanyProfile>({
    queryKey: COMPANY_PROFILE_KEY,
    queryFn: async () => {
      const res = await fetch("/api/company-profile", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });
  const [logo, setLogo] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (profile) setLogo(profile.logo);
  }, [profile]);

  const dirty = profile != null && logo !== profile.logo;

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file", description: "Please choose an image file.", variant: "destructive" });
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast({ title: "File too large", description: "Logo must be under 500 KB.", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLogo(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/company-profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ logo }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Save failed");
      }
      const updated: CompanyProfile = await res.json();
      queryClient.setQueryData(COMPANY_PROFILE_KEY, updated);
      setLogo(updated.logo);
      toast({ title: "Company logo saved", description: "It will now appear on invoices too." });
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (loading || !profile) {
    return <div className="py-8 text-center text-muted-foreground">Loading company profile...</div>;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            <CardTitle>Company Logo</CardTitle>
          </div>
          <CardDescription>
            Shown on the login screen and on printed/PDF invoices for <strong>{profile.name}</strong>
            (when "Show logo" is on in Print Settings). Only visible to your company — other companies
            on this platform manage their own logo separately.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="h-20 w-20 rounded-lg border bg-muted/30 flex items-center justify-center overflow-hidden shrink-0">
              {logo ? (
                <img src={logo} alt="Company logo" className="h-full w-full object-contain" />
              ) : (
                <Building2 className="h-8 w-8 text-muted-foreground/40" />
              )}
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} data-testid="button-upload-logo">
                  <Upload className="h-3.5 w-3.5 mr-1.5" /> {logo ? "Replace" : "Upload"}
                </Button>
                {logo && (
                  <Button variant="ghost" size="sm" onClick={() => setLogo(null)} data-testid="button-remove-logo">
                    <X className="h-3.5 w-3.5 mr-1.5" /> Remove
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">PNG, JPG, or SVG, under 500 KB.</p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/svg+xml,image/webp"
              className="hidden"
              onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ""; }}
            />
          </div>

          <div className="flex justify-end pt-2 border-t">
            <Button onClick={handleSave} disabled={!dirty || saving} data-testid="button-save-company-logo">
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Save Changes
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
