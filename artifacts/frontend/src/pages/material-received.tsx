import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ShieldAlert } from "lucide-react";
import { MaterialTransferTab } from "@/pages/manufacturing";
import { useRoleFeature, FEATURE_MATERIAL_RECEIVE } from "@/lib/permissions";
import { useAuth } from "@/contexts/use-auth";

// Store user's view of Material Transfer: log finished goods that came in
// from manufacturing (stock goes up, raw materials come off per BOM). Add
// only — editing/deleting stays with admin / manufacturing.
export default function MaterialReceived() {
  const allows = useRoleFeature();
  const { user } = useAuth();
  const canManage = user?.role === "admin" || user?.role === "super_admin" || user?.role === "manufacturing";

  if (!allows(FEATURE_MATERIAL_RECEIVE) && !canManage) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
          <ShieldAlert className="h-6 w-6" />
          You don't have permission to add material received entries. Ask your admin to turn on
          "Material Receive" for your role in Settings → Permissions.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Material Received</h1>
        <p className="text-muted-foreground mt-2">
          Enter finished goods received from manufacturing. Stock is added and the raw materials are reduced as per the BOM.
        </p>
      </div>
      <MaterialTransferTab canEdit={canManage} />
    </div>
  );
}
