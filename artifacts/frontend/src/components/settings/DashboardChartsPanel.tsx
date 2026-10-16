// Lets the admin choose which "stock by ..." pie charts show up on the
// Dashboard, and in what order — the dashboard itself just renders whatever
// this panel saves (see dashboard.tsx's dashboardStockCharts loop). Kept as
// its own tab rather than folded into Printing/Company since it's the one
// settings surface that shapes a *different page* (the Dashboard) instead of
// documents.

import { useEffect, useState } from "react";
import { useGetAppSettings, useUpdateAppSettings, getGetAppSettingsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Loader2, PieChart, Tag, LayoutGrid, Package, Wallet } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type ChartKey = "brand" | "category" | "product" | "finance";

const CHART_OPTIONS: { key: ChartKey; label: string; description: string; icon: typeof Tag }[] = [
  { key: "brand", label: "Stock by Brand", description: "Current stock value grouped by product brand.", icon: Tag },
  { key: "category", label: "Stock by Category", description: "Current stock value grouped by product group/category.", icon: LayoutGrid },
  { key: "product", label: "Stock by Product", description: "Current stock value for your top individual products.", icon: Package },
  { key: "finance", label: "Purchase vs Sale vs Due", description: "All-time Total Purchase, Total Sale, and Due (customer outstanding) in one pie.", icon: Wallet },
];

export function DashboardChartsPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useGetAppSettings();
  const updateSettings = useUpdateAppSettings();

  const [selected, setSelected] = useState<ChartKey[]>([]);

  useEffect(() => {
    if (settings) setSelected((settings.dashboardStockCharts as ChartKey[] | undefined) ?? []);
  }, [settings]);

  const dirty = settings != null && JSON.stringify(selected) !== JSON.stringify(settings.dashboardStockCharts ?? []);

  const toggle = (key: ChartKey, checked: boolean) => {
    setSelected((prev) => {
      if (checked) return prev.includes(key) ? prev : [...prev, key];
      return prev.filter((k) => k !== key);
    });
  };

  const handleSave = () => {
    updateSettings.mutate(
      { data: { dashboardStockCharts: selected } },
      {
        onSuccess: (updated) => {
          queryClient.setQueryData(getGetAppSettingsQueryKey(), updated);
          toast({ title: "Dashboard charts saved", description: "Changes show up on the Dashboard right away." });
        },
        onError: (err: any) => {
          toast({ title: "Save failed", description: err?.message, variant: "destructive" });
        },
      },
    );
  };

  if (isLoading || !settings) {
    return <div className="py-8 text-center text-muted-foreground">Loading dashboard settings...</div>;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <PieChart className="h-5 w-5 text-primary" />
            <CardTitle>Dashboard Stock Charts</CardTitle>
          </div>
          <CardDescription>
            Pick one or more pie charts to show on the Dashboard, breaking down current stock value by the
            dimension your business cares about. Leave all unchecked to hide this section entirely.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {CHART_OPTIONS.map(({ key, label, description, icon: Icon }) => (
            <label
              key={key}
              htmlFor={`chart-option-${key}`}
              className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/40 transition-colors"
            >
              <Checkbox
                id={`chart-option-${key}`}
                checked={selected.includes(key)}
                onCheckedChange={(v) => toggle(key, v === true)}
                className="mt-0.5"
                data-testid={`checkbox-dashboard-chart-${key}`}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <Label htmlFor={`chart-option-${key}`} className="font-medium cursor-pointer">{label}</Label>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
              </div>
            </label>
          ))}

          <div className="flex justify-end pt-2 border-t">
            <Button onClick={handleSave} disabled={!dirty || updateSettings.isPending} data-testid="button-save-dashboard-charts">
              {updateSettings.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Save Changes
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
