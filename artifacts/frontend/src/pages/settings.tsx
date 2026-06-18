import React, { useState, useEffect, useCallback } from "react";
import { useGetRolePermissions, useUpdateRolePermissions } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, Save, Printer, Hash, RefreshCw, Loader2 } from "lucide-react";
import { PrintSettingsPanel } from "@/components/settings/PrintSettingsPanel";

const TYPE_LABELS: Record<string, string> = {
  invoice: "Invoice",
  gst_invoice: "GST Invoice",
  bill_of_supply: "Bill of Supply",
  proforma_invoice: "Proforma Invoice",
  quotation: "Quotation",
  sale_return: "Sale Return (Credit Note)",
  delivery_challan: "Delivery Challan",
  payment_receipt: "Payment Receipt",
  sale_order: "Sale Order",
  purchase_order: "Purchase Order",
  purchase_invoice: "Purchase Invoice",
  purchase_return: "Purchase Return",
  order: "Customer Order",
};

const MONTH_ABBR = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

function computePreview(formatString: string, nextNumber: number): string {
  if (!formatString) return String(nextNumber);
  const d = new Date();
  const y4 = String(d.getFullYear());
  const y2 = y4.slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const mmm = MONTH_ABBR[d.getMonth()];
  const startYear = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  const fy = `${String(startYear).slice(-2)}-${String(startYear + 1).slice(-2)}`;
  return formatString
    .replace(/YYYY/g, y4).replace(/YY/g, y2)
    .replace(/MMM/g, mmm).replace(/MM/g, mm)
    .replace(/FY/g, fy).replace(/SEQ/g, String(nextNumber));
}

interface SeriesItem {
  seriesType: string;
  formatString: string | null;
  nextNumber: number;
  resetRule: string;
  preview?: string;
}

interface EditState {
  formatString: string;
  nextNumber: number;
  resetMonthly: boolean;
  dirty: boolean;
}

function SequencesTab() {
  const { toast } = useToast();
  const [series, setSeries] = useState<SeriesItem[]>([]);
  const [edits, setEdits] = useState<Record<string, EditState>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  const loadSeries = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/number-series", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      const data: SeriesItem[] = await res.json();
      setSeries(data);
      const initEdits: Record<string, EditState> = {};
      data.forEach((s) => {
        initEdits[s.seriesType] = {
          formatString: s.formatString ?? "",
          nextNumber: s.nextNumber,
          resetMonthly: s.resetRule === "monthly",
          dirty: false,
        };
      });
      setEdits(initEdits);
    } catch {
      toast({ title: "Failed to load document sequences", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadSeries(); }, [loadSeries]);

  const handleChange = (type: string, field: keyof EditState, value: string | number | boolean) => {
    setEdits((prev) => ({
      ...prev,
      [type]: { ...prev[type], [field]: value, dirty: true },
    }));
  };

  const handleSave = async (type: string) => {
    const edit = edits[type];
    if (!edit) return;
    setSaving((prev) => ({ ...prev, [type]: true }));
    try {
      const res = await fetch(`/api/number-series/${type}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          formatString: edit.formatString || undefined,
          nextNumber: Number(edit.nextNumber),
          resetRule: edit.resetMonthly ? "monthly" : "never",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Save failed");
      }
      const updated: SeriesItem = await res.json();
      setSeries((prev) => prev.map((s) => s.seriesType === type ? updated : s));
      setEdits((prev) => ({
        ...prev,
        [type]: {
          formatString: updated.formatString ?? "",
          nextNumber: updated.nextNumber,
          resetMonthly: updated.resetRule === "monthly",
          dirty: false,
        },
      }));
      toast({ title: `${TYPE_LABELS[type] ?? type} sequence saved` });
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving((prev) => ({ ...prev, [type]: false }));
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            Configure how document numbers are generated. Use tokens:{" "}
            <code className="text-xs bg-muted px-1 rounded">SEQ</code>{" "}
            <code className="text-xs bg-muted px-1 rounded">MM</code>{" "}
            <code className="text-xs bg-muted px-1 rounded">MMM</code>{" "}
            <code className="text-xs bg-muted px-1 rounded">YYYY</code>{" "}
            <code className="text-xs bg-muted px-1 rounded">YY</code>{" "}
            <code className="text-xs bg-muted px-1 rounded">FY</code>
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadSeries}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {series.map((s) => {
          const edit = edits[s.seriesType];
          if (!edit) return null;
          const preview = computePreview(edit.formatString, edit.nextNumber);
          return (
            <Card key={s.seriesType} className={edit.dirty ? "border-primary/50 shadow-sm" : ""}>
              <CardHeader className="pb-3 pt-4 px-4">
                <CardTitle className="text-sm font-semibold">
                  {TYPE_LABELS[s.seriesType] ?? s.seriesType}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Format</Label>
                  <Input
                    className="font-mono text-sm h-8"
                    value={edit.formatString}
                    onChange={(e) => handleChange(s.seriesType, "formatString", e.target.value)}
                    placeholder="e.g. INV/MM/SEQ"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Next Number</Label>
                  <Input
                    type="number"
                    min={1}
                    className="h-8 w-28"
                    value={edit.nextNumber}
                    onChange={(e) => handleChange(s.seriesType, "nextNumber", Number(e.target.value))}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground cursor-pointer">Reset monthly</Label>
                  <Switch
                    checked={edit.resetMonthly}
                    onCheckedChange={(v) => handleChange(s.seriesType, "resetMonthly", v)}
                  />
                </div>
                <div className="flex items-center justify-between pt-1 border-t">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Preview:</span>
                    <Badge variant="secondary" className="font-mono text-xs">
                      {preview}
                    </Badge>
                  </div>
                  <Button
                    size="sm"
                    variant={edit.dirty ? "default" : "outline"}
                    className="h-7 text-xs"
                    onClick={() => handleSave(s.seriesType)}
                    disabled={saving[s.seriesType]}
                  >
                    {saving[s.seriesType] ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <><Save className="h-3 w-3 mr-1" />Save</>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export default function Settings() {
  const { data: permissions, isLoading } = useGetRolePermissions();
  const updatePermissions = useUpdateRolePermissions();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [localPerms, setLocalPerms] = useState<Record<string, Record<string, boolean>>>({});
  const [hasChanges, setHasChanges] = useState(false);

  React.useEffect(() => {
    if (permissions && !hasChanges) {
      const permsObj: Record<string, Record<string, boolean>> = {};
      permissions.forEach(p => {
        if (!permsObj[p.role]) permsObj[p.role] = {};
        permsObj[p.role][p.feature] = p.allowed;
      });
      setLocalPerms(permsObj);
    }
  }, [permissions, hasChanges]);

  const roles = ["admin", "salesman", "store", "manufacturing", "accountant", "customer"];
  const features = ["catalog_view", "catalog_edit", "billing", "inventory_edit", "payments_approve", "manufacturing_edit"];

  const handleToggle = (role: string, feature: string, checked: boolean) => {
    setLocalPerms(prev => ({
      ...prev,
      [role]: { ...(prev[role] || {}), [feature]: checked }
    }));
    setHasChanges(true);
  };

  const handleSave = () => {
    const flatPerms: any[] = [];
    Object.entries(localPerms).forEach(([role, features]) => {
      Object.entries(features).forEach(([feature, allowed]) => {
        flatPerms.push({ role, feature, allowed });
      });
    });

    updatePermissions.mutate({
      data: { permissions: flatPerms }
    }, {
      onSuccess: () => {
        toast({ title: "Permissions updated successfully" });
        setHasChanges(false);
        queryClient.invalidateQueries({ queryKey: ['/api/auth/permissions'] });
      },
      onError: () => {
        toast({ title: "Failed to update permissions", variant: "destructive" });
      }
    });
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">System Settings</h1>
        <p className="text-muted-foreground mt-2">Manage role permissions, print configuration, and document sequences.</p>
      </div>

      <Tabs defaultValue="sequences">
        <TabsList>
          <TabsTrigger value="sequences" data-testid="tab-sequences">
            <Hash className="mr-2 h-4 w-4" /> Document Sequences
          </TabsTrigger>
          <TabsTrigger value="permissions" data-testid="tab-permissions">
            <ShieldCheck className="mr-2 h-4 w-4" /> Permissions
          </TabsTrigger>
          <TabsTrigger value="printing" data-testid="tab-printing">
            <Printer className="mr-2 h-4 w-4" /> Printing
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sequences" className="space-y-4 mt-4">
          <SequencesTab />
        </TabsContent>

        <TabsContent value="permissions" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={!hasChanges || updatePermissions.isPending}>
              <Save className="mr-2 h-4 w-4" /> Save Changes
            </Button>
          </div>
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" />
                <CardTitle>Role Permissions Matrix</CardTitle>
              </div>
              <CardDescription>Control which features each role can access.</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {isLoading ? (
                <div className="py-8 text-center text-muted-foreground">Loading permissions...</div>
              ) : (
                <table className="w-full text-sm text-left border-collapse">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium border-b w-[200px]">Feature</th>
                      {roles.map(role => (
                        <th key={role} className="px-4 py-3 font-medium border-b text-center capitalize">{role}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {features.map(feature => (
                      <tr key={feature} className="border-b hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3 font-medium text-foreground">
                          {feature.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                        </td>
                        {roles.map(role => (
                          <td key={`${role}-${feature}`} className="px-4 py-3 text-center">
                            <Switch
                              checked={localPerms[role]?.[feature] || false}
                              onCheckedChange={(checked) => handleToggle(role, feature, checked)}
                              disabled={role === "admin"}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="printing">
          <PrintSettingsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
