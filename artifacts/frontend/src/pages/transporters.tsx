import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Truck, Plus, Pencil, Loader2 } from "lucide-react";

interface Transporter {
  id: number;
  name: string;
  gstin: string | null;
  transporterId: string | null;
  contactName: string | null;
  contactMobile: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
}

export default function TransportersPage() {
  const { data, isLoading, refetch } = useQuery<Transporter[]>({
    queryKey: ["transporters"],
    queryFn: async () => {
      const res = await fetch("/api/transporters", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Transporter | null>(null);

  const handleNew = () => { setEditing(null); setOpen(true); };
  const handleEdit = (t: Transporter) => { setEditing(t); setOpen(true); };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Transporter Master</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage transporters used for dispatches and E-Way Bill generation.
          </p>
        </div>
        <Button onClick={handleNew}>
          <Plus className="w-4 h-4 mr-2" /> Add Transporter
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-12 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" /></div>
          ) : !data || data.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <Truck className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No transporters yet. Add your first transporter to get started.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>GSTIN</TableHead>
                  <TableHead>Transporter ID</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-16"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((t) => (
                  <TableRow key={t.id} className={!t.isActive ? "opacity-50" : ""}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell className="font-mono text-sm">{t.gstin ?? "—"}</TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">{t.transporterId ?? "—"}</TableCell>
                    <TableCell className="text-sm">
                      {t.contactName && <div>{t.contactName}</div>}
                      {t.contactMobile && <div className="text-muted-foreground">{t.contactMobile}</div>}
                      {!t.contactName && !t.contactMobile && "—"}
                    </TableCell>
                    <TableCell>
                      {t.isActive ? <Badge variant="secondary">Active</Badge> : <Badge variant="outline">Inactive</Badge>}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => handleEdit(t)}>
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

      <TransporterDialog open={open} onOpenChange={setOpen} editing={editing} onSaved={() => refetch()} />
    </div>
  );
}

function TransporterDialog({
  open, onOpenChange, editing, onSaved,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; editing: Transporter | null; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [gstin, setGstin] = useState("");
  const [transporterId, setTransporterId] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactMobile, setContactMobile] = useState("");
  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.name);
      setGstin(editing.gstin ?? "");
      setTransporterId(editing.transporterId ?? "");
      setContactName(editing.contactName ?? "");
      setContactMobile(editing.contactMobile ?? "");
      setNotes(editing.notes ?? "");
      setIsActive(editing.isActive);
    } else {
      setName(""); setGstin(""); setTransporterId(""); setContactName("");
      setContactMobile(""); setNotes(""); setIsActive(true);
    }
  }, [open, editing]);

  const handleSave = async () => {
    if (!name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const url = editing ? `/api/transporters/${editing.id}` : "/api/transporters";
      const method = editing ? "PUT" : "POST";
      const res = await fetch(url, {
        method, credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, gstin: gstin || undefined, transporterId: transporterId || undefined,
          contactName: contactName || undefined, contactMobile: contactMobile || undefined,
          notes: notes || undefined, isActive }),
      });
      const data = await res.json();
      if (!res.ok) { toast({ title: data.error ?? "Save failed", variant: "destructive" }); return; }
      toast({ title: editing ? "Transporter updated" : "Transporter added" });
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Transporter" : "Add Transporter"}</DialogTitle>
          <DialogDescription>
            Transporter details for dispatch and E-Way Bill. Transporter ID is the GSTIN-based ID used by the GST portal.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sharma Transport Co." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>GSTIN <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} placeholder="27XXXXX..." className="uppercase" />
            </div>
            <div className="space-y-1.5">
              <Label>Transporter ID <span className="text-muted-foreground text-xs">(E-Way Bill)</span></Label>
              <Input value={transporterId} onChange={(e) => setTransporterId(e.target.value)} placeholder="Auto-fill from API" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Contact Name</Label>
              <Input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Optional" />
            </div>
            <div className="space-y-1.5">
              <Label>Contact Mobile</Label>
              <Input value={contactMobile} onChange={(e) => setContactMobile(e.target.value)} placeholder="Optional" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
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
            {editing ? "Save Changes" : "Add Transporter"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
