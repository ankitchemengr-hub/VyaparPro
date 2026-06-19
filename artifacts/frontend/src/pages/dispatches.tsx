import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { PackageCheck, Plus, Pencil, Loader2, FileText } from "lucide-react";
import { Link } from "wouter";

interface Dispatch {
  id: number;
  invoiceId: number | null;
  invoiceNo: string | null;
  transporterName: string | null;
  vehicleNumber: string | null;
  lrNumber: string | null;
  transportMode: string;
  distanceKm: number | null;
  ewayBillStatus: string;
  ewayBillNumber: string | null;
  ewayBillDate: string | null;
  ewayBillValidityDate: string | null;
  notes: string | null;
  createdAt: string;
}

interface Transporter { id: number; name: string; gstin: string | null; isActive: boolean; }
interface Vehicle { id: number; vehicleNumber: string; vehicleType: string; isActive: boolean; }

const EWAY_STATUS_META: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  pending:      { label: "Pending",      variant: "outline" },
  generated:    { label: "Generated",    variant: "secondary" },
  cancelled:    { label: "Cancelled",    variant: "destructive" },
  not_required: { label: "Not Required", variant: "outline" },
};

const TRANSPORT_MODE_LABELS: Record<string, string> = {
  road: "Road", rail: "Rail", air: "Air", ship: "Ship",
};

function fmt(dateStr: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export default function DispatchesPage() {
  const { data, isLoading, refetch } = useQuery<Dispatch[]>({
    queryKey: ["dispatches"],
    queryFn: async () => {
      const res = await fetch("/api/dispatches", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const { data: transporters } = useQuery<Transporter[]>({
    queryKey: ["transporters"],
    queryFn: async () => {
      const res = await fetch("/api/transporters", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: vehicles } = useQuery<Vehicle[]>({
    queryKey: ["vehicles"],
    queryFn: async () => {
      const res = await fetch("/api/vehicles", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Dispatch | null>(null);

  const handleNew = () => { setEditing(null); setOpen(true); };
  const handleEdit = (d: Dispatch) => { setEditing(d); setOpen(true); };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dispatch</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Dispatch records with transport details and E-Way Bill status. E-Way Bill API can be connected later.
          </p>
        </div>
        <Button onClick={handleNew}>
          <Plus className="w-4 h-4 mr-2" /> New Dispatch
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-12 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" /></div>
          ) : !data || data.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <PackageCheck className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No dispatch records yet. Create one linked to an invoice.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Transporter</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>LR No.</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>E-Way Bill</TableHead>
                  <TableHead>E-Way No.</TableHead>
                  <TableHead>Valid Till</TableHead>
                  <TableHead className="w-16"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((d) => {
                  const statusMeta = EWAY_STATUS_META[d.ewayBillStatus] ?? EWAY_STATUS_META.pending;
                  return (
                    <TableRow key={d.id}>
                      <TableCell>
                        {d.invoiceId ? (
                          <Link href={`/invoices/${d.invoiceId}`} className="flex items-center gap-1 text-primary hover:underline font-medium">
                            <FileText className="w-3.5 h-3.5" />
                            {d.invoiceNo ?? `#${d.invoiceId}`}
                          </Link>
                        ) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-sm">{d.transporterName ?? "—"}</TableCell>
                      <TableCell className="font-mono text-sm">{d.vehicleNumber ?? "—"}</TableCell>
                      <TableCell className="font-mono text-sm">{d.lrNumber ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {TRANSPORT_MODE_LABELS[d.transportMode] ?? d.transportMode}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusMeta.variant} className="text-xs">
                          {statusMeta.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-sm">{d.ewayBillNumber ?? "—"}</TableCell>
                      <TableCell className="text-sm">{fmt(d.ewayBillValidityDate)}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => handleEdit(d)}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <DispatchDialog
        open={open}
        onOpenChange={setOpen}
        editing={editing}
        transporters={transporters?.filter((t) => t.isActive) ?? []}
        vehicles={vehicles?.filter((v) => v.isActive) ?? []}
        onSaved={() => refetch()}
      />
    </div>
  );
}

function DispatchDialog({
  open, onOpenChange, editing, transporters, vehicles, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: Dispatch | null;
  transporters: Transporter[];
  vehicles: Vehicle[];
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [invoiceNo, setInvoiceNo] = useState("");
  const [transporterId, setTransporterId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [lrNumber, setLrNumber] = useState("");
  const [transportMode, setTransportMode] = useState("road");
  const [distanceKm, setDistanceKm] = useState("");
  const [ewayBillStatus, setEwayBillStatus] = useState("pending");
  const [ewayBillNumber, setEwayBillNumber] = useState("");
  const [ewayBillDate, setEwayBillDate] = useState("");
  const [ewayBillValidityDate, setEwayBillValidityDate] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const toDateInput = (iso: string | null) => iso ? iso.slice(0, 10) : "";

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setInvoiceNo(editing.invoiceNo ?? "");
      setTransporterId(editing.transporterName ? "" : ""); // will be set from id below
      setVehicleId("");
      setLrNumber(editing.lrNumber ?? "");
      setTransportMode(editing.transportMode);
      setDistanceKm(editing.distanceKm ? String(editing.distanceKm) : "");
      setEwayBillStatus(editing.ewayBillStatus);
      setEwayBillNumber(editing.ewayBillNumber ?? "");
      setEwayBillDate(toDateInput(editing.ewayBillDate));
      setEwayBillValidityDate(toDateInput(editing.ewayBillValidityDate));
      setNotes(editing.notes ?? "");
    } else {
      setInvoiceNo(""); setTransporterId(""); setVehicleId("");
      setLrNumber(""); setTransportMode("road"); setDistanceKm("");
      setEwayBillStatus("pending"); setEwayBillNumber("");
      setEwayBillDate(""); setEwayBillValidityDate(""); setNotes("");
    }
  }, [open, editing]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const url = editing ? `/api/dispatches/${editing.id}` : "/api/dispatches";
      const method = editing ? "PUT" : "POST";
      const body: any = {
        transporterId: transporterId ? parseInt(transporterId, 10) : undefined,
        vehicleId: vehicleId ? parseInt(vehicleId, 10) : undefined,
        lrNumber: lrNumber || undefined,
        transportMode,
        distanceKm: distanceKm ? parseInt(distanceKm, 10) : undefined,
        ewayBillStatus,
        ewayBillNumber: ewayBillNumber || undefined,
        ewayBillDate: ewayBillDate || undefined,
        ewayBillValidityDate: ewayBillValidityDate || undefined,
        notes: notes || undefined,
      };
      if (!editing) {
        body.invoiceNo = invoiceNo || undefined;
      }
      const res = await fetch(url, {
        method, credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { toast({ title: data.error ?? "Save failed", variant: "destructive" }); return; }
      toast({ title: editing ? "Dispatch updated" : "Dispatch created" });
      onSaved();
      onOpenChange(false);
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const isGenerated = ewayBillStatus === "generated";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Dispatch" : "New Dispatch"}</DialogTitle>
          <DialogDescription>
            Record transport and E-Way Bill details. E-Way Bill API integration can be connected later.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Invoice */}
          {!editing && (
            <div className="space-y-1.5">
              <Label>Invoice No. <span className="text-muted-foreground text-xs">(optional — link to an invoice)</span></Label>
              <Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="e.g. INV-202506-00001" />
            </div>
          )}

          {/* Transport */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Transporter</Label>
              <Select value={transporterId || "__none__"} onValueChange={(v) => setTransporterId(v === "__none__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Select transporter" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {transporters.map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Vehicle</Label>
              <Select value={vehicleId || "__none__"} onValueChange={(v) => setVehicleId(v === "__none__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Select vehicle" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {vehicles.map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.vehicleNumber}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>LR Number</Label>
              <Input value={lrNumber} onChange={(e) => setLrNumber(e.target.value)} placeholder="Lorry Receipt No." />
            </div>
            <div className="space-y-1.5">
              <Label>Transport Mode</Label>
              <Select value={transportMode} onValueChange={setTransportMode}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="road">Road</SelectItem>
                  <SelectItem value="rail">Rail</SelectItem>
                  <SelectItem value="air">Air</SelectItem>
                  <SelectItem value="ship">Ship</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Distance (km)</Label>
              <Input type="number" min="0" value={distanceKm} onChange={(e) => setDistanceKm(e.target.value)} placeholder="Optional" />
            </div>
          </div>

          {/* E-Way Bill section */}
          <div className="rounded-lg border p-4 space-y-4 bg-muted/30">
            <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              <PackageCheck className="w-4 h-4" /> E-Way Bill Details
            </div>

            <div className="space-y-1.5">
              <Label>E-Way Bill Status</Label>
              <Select value={ewayBillStatus} onValueChange={setEwayBillStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="generated">Generated</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                  <SelectItem value="not_required">Not Required</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>E-Way Bill Number</Label>
                <Input
                  value={ewayBillNumber}
                  onChange={(e) => setEwayBillNumber(e.target.value)}
                  placeholder={isGenerated ? "12-digit number" : "Auto-filled by API"}
                  disabled={!isGenerated && ewayBillStatus !== "generated"}
                />
              </div>
              <div className="space-y-1.5">
                <Label>E-Way Bill Date</Label>
                <Input
                  type="date"
                  value={ewayBillDate}
                  onChange={(e) => setEwayBillDate(e.target.value)}
                  disabled={ewayBillStatus === "pending" || ewayBillStatus === "not_required"}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Validity Date</Label>
                <Input
                  type="date"
                  value={ewayBillValidityDate}
                  onChange={(e) => setEwayBillValidityDate(e.target.value)}
                  disabled={ewayBillStatus === "pending" || ewayBillStatus === "not_required"}
                />
              </div>
            </div>

            {ewayBillStatus === "pending" && (
              <p className="text-xs text-muted-foreground bg-amber-50 border border-amber-200 rounded px-3 py-2">
                E-Way Bill fields will be auto-filled when the GST E-Way Bill API is connected. Set status to "Generated" to enter manually.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Any additional notes" />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            {editing ? "Save Changes" : "Create Dispatch"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
