import React, { useState } from "react";
import { useGetRolePermissions, useUpdateRolePermissions } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, Save, Printer } from "lucide-react";
import { PrintSettingsPanel } from "@/components/settings/PrintSettingsPanel";

export default function Settings() {
  const { data: permissions, isLoading } = useGetRolePermissions();
  const updatePermissions = useUpdateRolePermissions();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [localPerms, setLocalPerms] = useState<Record<string, Record<string, boolean>>>({});
  const [hasChanges, setHasChanges] = useState(false);

  // Initialize local state from server data
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
      [role]: {
        ...(prev[role] || {}),
        [feature]: checked
      }
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
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">System Settings</h1>
        <p className="text-muted-foreground mt-2">Manage role permissions and print configuration.</p>
      </div>

      <Tabs defaultValue="permissions">
        <TabsList>
          <TabsTrigger value="permissions" data-testid="tab-permissions">
            <ShieldCheck className="mr-2 h-4 w-4" /> Permissions
          </TabsTrigger>
          <TabsTrigger value="printing" data-testid="tab-printing">
            <Printer className="mr-2 h-4 w-4" /> Printing
          </TabsTrigger>
        </TabsList>

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
                              disabled={role === "admin"} // Admin always has full access implicitly
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
