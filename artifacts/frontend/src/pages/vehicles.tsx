import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Car, Plus, Pencil, Loader2 } from "lucide-react";

interface Vehicle {
  id: number;
  vehicleNumber: string;
  vehicleType: string;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
}

const VEHICLE_TYPE_LABELS: Record<string, string> = {
  regular: "Regular",
  over_dimensional_cargo: "Over Dimensional Cargo (ODC)",
};

export default function VehiclesPage() {
  const { data, isLoading, refetch } = useQuery<Vehicle[]>({
    queryKey: ["vehicles"],
    queryFn: async () => {
      const res = await fetch("/api/vehicles", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Vehicle | null>(null);

  const handleNew = () => { setEditing(null); setOpen(true); };
  const handleEdit = (v: Vehicle) => { setEditing(v); setOpen(true); };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Vehicle Master</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage vehicles used for dispatches and E-Way Bill generation.
          </p>
        </div>
        <Button onClick={handleNew}>
          <Plus className="w-4 h-4 mr-2" /> Add Vehicle
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-12 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" /></div>
          ) : !data || data.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <Car className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No vehicles yet. Add vehicles to use them in dispatch records.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vehicle Number</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-16"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((v) => (
                  <TableRow key={v.id} className={!v.isActive ? "opacity-50" : ""}>
                    <TableCell className="font-mono font-semibold text-base">{v.vehicleNumber}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{VEHICLE_TYPE_LABELS[v.vehicleType] ?? v.vehicleType}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{v.notes ?? "—"}</TableCell>
                    <TableCell>
                      {v.isActive ? <Badge variant="secondary">Active</Badge> : <Badge variant="outline">Inactive</Badge>}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => handleEdit(v)}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <VehicleDialog open={open} onOpenChange={setOpen} editing={editing} onSaved={() => refetch()} />
    </div>
  );
}

function VehicleDialog({
  open, onOpenChange, editing, onSaved,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; editing: Vehicle | null; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [vehicleType, setVehicleType] = useState("regular");
  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setVehicleNumber(editing.vehicleNumber);
      setVehicleType(editing.vehicleType);
      setNotes(editing.notes ?? "");
      setIsActive(editing.isActive);
    } else {
      setVehicleNumber(""); setVehicleType("regular"); setNotes(""); setIsActive(true);
    }
  }, [open, editing]);

  const handleSave = async () => {
    if (!vehicleNumber.trim()) { toast({ title: "Vehicle number is required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const url = editing ? `/api/vehicles/${editing.id}` : "/api/vehicles";
      const method = editing ? "PUT" : "POST";
      const res = await fetch(url, {
        method, credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehicleNumber, vehicleType, notes: notes || undefined, isActive }),
      });
      const data = await res.json();
      if (!res.ok) { toast({ title: data.error ?? "Save failed", variant: "destructive" }); return; }
      toast({ title: editing ? "Vehicle updated" : "Vehicle added" });
      onSaved();
      onOpenChange(false);
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Vehicle" : "Add Vehicle"}</DialogTitle>
          <DialogDescription>Vehicle details for dispatch records and E-Way Bill.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Vehicle Number *</Label>
            <Input
              value={vehicleNumber}
              onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())}
              placeholder="e.g. MH12AB1234"
              className="uppercase font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Vehicle Type</Label>
            <Select value={vehicleType} onValueChange={setVehicleType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="regular">Regular</SelectItem>
                <SelectItem value="over_dimensional_cargo">Over Dimensional Cargo (ODC)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. 10 ton capacity" />
          </div>
          {editing && (
            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label className="m-0">Active</Label>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            {editing ? "Save Changes" : "Add Vehicle"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
