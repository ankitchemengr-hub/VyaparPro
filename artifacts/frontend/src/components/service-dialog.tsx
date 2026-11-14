import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateProduct, useUpdateProduct, getListProductsQueryKey } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Wrench } from "lucide-react";

// Add / edit a service (repair, installation, labour, AMC, transport…).
// It is a product row with itemType "service": billed like any item, with a
// SAC code instead of an HSN code, and it never has stock (the server keeps
// a service's stock at 0 whatever happens).

export const SERVICE_UNITS = ["Job", "Hour", "Visit", "Day", "Month", "Year", "Service", "Nos"];
const GST_RATES = ["0", "5", "12", "18", "28"];

type ServiceForm = {
  name: string;
  printName: string;
  itemCode: string;
  sacCode: string;
  group: string;
  unit: string;
  retailPrice: string;
  wholesalePrice: string;
  nonGstPrice: string;
  costPrice: string;
  taxRate: string;
  active: boolean;
};

const emptyForm: ServiceForm = {
  name: "", printName: "", itemCode: "", sacCode: "", group: "Services", unit: "Job",
  retailPrice: "", wholesalePrice: "", nonGstPrice: "", costPrice: "", taxRate: "18", active: true,
};

function suggestServiceCode(name: string): string {
  const words = name.toUpperCase().replace(/[^A-Z0-9\s]/g, "").split(/\s+/).filter(Boolean);
  const body = words.slice(0, 2).map((w) => (/\d/.test(w) ? w : w.slice(0, 4))).join("-");
  return body ? `SRV-${body}` : "";
}

const num = (v: string) => (v.trim() === "" ? undefined : Number(v));

export function ServiceDialog({ open, onOpenChange, service }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  service?: any;
}) {
  const isEdit = !!service;
  const [form, setForm] = useState<ServiceForm>(emptyForm);
  const [codeAuto, setCodeAuto] = useState(true);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const saving = createProduct.isPending || updateProduct.isPending;

  useEffect(() => {
    if (!open) return;
    if (service) {
      setForm({
        name: service.name ?? "",
        printName: service.printName ?? "",
        itemCode: service.itemCode ?? "",
        sacCode: service.hsnCode ?? "",
        group: service.group ?? "Services",
        unit: service.unit ?? "Job",
        retailPrice: service.retailPrice != null ? String(service.retailPrice) : "",
        wholesalePrice: service.wholesalePrice != null ? String(service.wholesalePrice) : "",
        nonGstPrice: service.nonGstPrice != null ? String(service.nonGstPrice) : "",
        costPrice: service.purchasePrice ? String(service.purchasePrice) : "",
        taxRate: service.taxRate != null ? String(Number(service.taxRate)) : "18",
        active: !service.notForSale,
      });
      setCodeAuto(false);
    } else {
      setForm(emptyForm);
      setCodeAuto(true);
    }
  }, [open, service]);

  const set = <K extends keyof ServiceForm>(key: K, value: ServiceForm[K]) =>
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "name" && codeAuto) next.itemCode = suggestServiceCode(String(value));
      return next;
    });

  const handleSave = () => {
    const name = form.name.trim();
    const itemCode = form.itemCode.trim();
    const retail = Number(form.retailPrice);
    if (!name) { toast({ title: "Enter the service name", variant: "destructive" }); return; }
    if (!itemCode) { toast({ title: "Enter a service code", variant: "destructive" }); return; }
    if (form.active && !(retail > 0)) { toast({ title: "Enter the service price", variant: "destructive" }); return; }
    const sac = form.sacCode.trim();
    if (sac && !/^\d{4,8}$/.test(sac)) {
      toast({ title: "SAC code should be 4–8 digits", description: "Services use SAC codes starting with 99, e.g. 998719 (repair).", variant: "destructive" });
      return;
    }

    const payload = {
      itemType: "service" as const,
      name,
      printName: form.printName.trim() || undefined,
      itemCode,
      hsnCode: sac || undefined,
      group: form.group.trim() || "Services",
      brand: service?.brand || "Service",
      unit: form.unit.trim() || "Job",
      purchasePrice: num(form.costPrice) ?? 0,
      retailPrice: retail || 0,
      wholesalePrice: num(form.wholesalePrice) ?? (retail || 0),
      nonGstPrice: num(form.nonGstPrice),
      mrp: 0,
      taxRate: Number(form.taxRate),
      notForSale: !form.active,
      addForManufacturing: false,
    };

    const handleError = async (err: any, fallback: string) => {
      let desc = err?.message ?? "Server error";
      try {
        const body = err?.response ? await err.response.json() : null;
        if (body?.error) desc = String(body.error).slice(0, 300);
      } catch {}
      toast({ title: fallback, description: desc, variant: "destructive" });
    };
    const done = (title: string) => {
      queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
      toast({ title });
      onOpenChange(false);
    };

    if (isEdit) {
      updateProduct.mutate(
        { id: service.id, data: payload },
        { onSuccess: (s) => done(`Updated "${s.name}"`), onError: (e) => handleError(e, "Could not update the service") },
      );
    } else {
      createProduct.mutate(
        { data: payload },
        { onSuccess: (s) => done(`Service "${s.name}" added`), onError: (e) => handleError(e, "Could not add the service") },
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="w-5 h-5 text-primary" />{isEdit ? "Edit Service" : "Add Service"}
          </DialogTitle>
          <DialogDescription>
            Repair, installation, labour, AMC, transport… Billed like an item with a SAC code. A service has no stock.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Service Name *</Label>
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Engine Oil Change Labour" data-testid="input-service-name" autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label>Service Code *</Label>
              <Input
                value={form.itemCode}
                onChange={(e) => { setCodeAuto(false); set("itemCode", e.target.value); }}
                placeholder="e.g. SRV-OIL"
                className="font-mono"
                data-testid="input-service-code"
              />
            </div>
            <div className="space-y-1.5">
              <Label>SAC Code <span className="text-xs text-muted-foreground">(HSN for services)</span></Label>
              <Input
                value={form.sacCode}
                onChange={(e) => set("sacCode", e.target.value.replace(/\D/g, "").slice(0, 8))}
                placeholder="e.g. 998719"
                inputMode="numeric"
                className="font-mono"
                data-testid="input-service-sac"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Input value={form.group} onChange={(e) => set("group", e.target.value)} placeholder="Services" />
            </div>
            <div className="space-y-1.5">
              <Label>Charged per</Label>
              <Select value={form.unit} onValueChange={(v) => set("unit", v)}>
                <SelectTrigger data-testid="select-service-unit"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(SERVICE_UNITS.includes(form.unit) ? SERVICE_UNITS : [form.unit, ...SERVICE_UNITS]).map((u) => (
                    <SelectItem key={u} value={u}>{u}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-lg border p-3 space-y-3">
            <div className="text-sm font-semibold">Price</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Retail Price (₹){form.active ? " *" : ""}</Label>
                <Input type="number" min="0" step="0.01" value={form.retailPrice} onChange={(e) => set("retailPrice", e.target.value)} placeholder="0.00" data-testid="input-service-price" />
              </div>
              <div className="space-y-1.5">
                <Label>Wholesale Price (₹) <span className="text-xs text-muted-foreground">(blank = retail)</span></Label>
                <Input type="number" min="0" step="0.01" value={form.wholesalePrice} onChange={(e) => set("wholesalePrice", e.target.value)} placeholder="Same as retail" />
              </div>
              <div className="space-y-1.5">
                <Label>Non-GST Price (₹) <span className="text-xs text-muted-foreground">(optional)</span></Label>
                <Input type="number" min="0" step="0.01" value={form.nonGstPrice} onChange={(e) => set("nonGstPrice", e.target.value)} placeholder="For non-GST bills" />
              </div>
              <div className="space-y-1.5">
                <Label>GST Rate (%)</Label>
                <Select value={form.taxRate} onValueChange={(v) => set("taxRate", v)}>
                  <SelectTrigger data-testid="select-service-gst"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {GST_RATES.map((r) => <SelectItem key={r} value={r}>{r}%</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Cost to you (₹) <span className="text-xs text-muted-foreground">(optional, for profit)</span></Label>
                <Input type="number" min="0" step="0.01" value={form.costPrice} onChange={(e) => set("costPrice", e.target.value)} placeholder="e.g. mechanic's charge" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
            <div className="space-y-1.5">
              <Label>Print Name <span className="text-xs text-muted-foreground">(on invoice, optional)</span></Label>
              <Input value={form.printName} onChange={(e) => set("printName", e.target.value)} placeholder="Same as service name" />
            </div>
            <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <span className="text-sm">
                <span className="font-medium">Available in billing</span>
                <span className="block text-xs text-muted-foreground">Off = hidden from new bills</span>
              </span>
              <Switch checked={form.active} onCheckedChange={(v) => set("active", v)} />
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} data-testid="button-save-service">
            {saving && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}{isEdit ? "Save" : "Add Service"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
