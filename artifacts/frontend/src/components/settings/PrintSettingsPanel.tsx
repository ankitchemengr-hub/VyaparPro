// Per-company print settings editor. Four tabs: General, Document, Header & Terms,
// Default Printers. Admin-only (the API enforces this on PUT).

import { useEffect, useState } from "react";
import {
  useGetPrintSettings,
  useUpdatePrintSettings,
  getGetPrintSettingsQueryKey,
  type PrintSettings,
  type PrintSettingsUpdate,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Save, Eye } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { TEMPLATES } from "@/components/invoice-templates/registry";
import { InvoiceTemplateSelector } from "@/components/invoice-templates/InvoiceTemplateSelector";
import { SAMPLE_INVOICE, SAMPLE_MAPS } from "@/components/invoice-templates/sample";

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  testId,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  testId: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b py-3 last:border-b-0">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {description && <div className="text-xs text-muted-foreground">{description}</div>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} data-testid={testId} />
    </div>
  );
}

export function PrintSettingsPanel() {
  const { data, isLoading } = useGetPrintSettings();
  const update = useUpdatePrintSettings();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [form, setForm] = useState<PrintSettings | null>(null);
  const [dirty, setDirty] = useState(false);
  const [selectorOpen, setSelectorOpen] = useState(false);

  useEffect(() => {
    if (data && !dirty) setForm(data);
  }, [data, dirty]);

  if (isLoading || !form) {
    return <div className="py-8 text-center text-muted-foreground">Loading print settings...</div>;
  }

  const set = <K extends keyof PrintSettings>(key: K, value: PrintSettings[K]) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
    setDirty(true);
  };

  const handleSave = () => {
    if (!form) return;
    const payload: PrintSettingsUpdate = { ...form };
    update.mutate(
      { data: payload },
      {
        onSuccess: () => {
          toast({ title: "Print settings saved" });
          setDirty(false);
          queryClient.invalidateQueries({ queryKey: getGetPrintSettingsQueryKey() });
        },
        onError: () => toast({ title: "Failed to save print settings", variant: "destructive" }),
      },
    );
  };

  const defaultMeta = TEMPLATES.find((t) => t.id === form.defaultTemplate);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          onClick={() => setSelectorOpen(true)}
          data-testid="button-open-template-selector"
        >
          <Eye className="mr-2 h-4 w-4" /> Choose Template
        </Button>
        <Button onClick={handleSave} disabled={!dirty || update.isPending} data-testid="button-save-print-settings">
          <Save className="mr-2 h-4 w-4" /> Save Print Settings
        </Button>
      </div>

      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general" data-testid="tab-print-general">General</TabsTrigger>
          <TabsTrigger value="document" data-testid="tab-print-document">Document</TabsTrigger>
          <TabsTrigger value="header" data-testid="tab-print-header">Header &amp; Terms</TabsTrigger>
          <TabsTrigger value="printers" data-testid="tab-print-printers">Default Printers</TabsTrigger>
        </TabsList>

        {/* General */}
        <TabsContent value="general">
          <Card>
            <CardContent className="space-y-4 pt-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Default Template</Label>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 rounded-md border px-3 py-2 text-sm">
                      {defaultMeta ? `${defaultMeta.name} (${defaultMeta.paper})` : form.defaultTemplate}
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setSelectorOpen(true)}>
                      Change
                    </Button>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="copies">Copies</Label>
                  <Input
                    id="copies"
                    type="number"
                    min={1}
                    max={5}
                    value={form.copies}
                    onChange={(e) => set("copies", Math.max(1, Number(e.target.value) || 1))}
                    data-testid="input-copies"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Color Mode</Label>
                  <Select value={form.colorMode} onValueChange={(v) => set("colorMode", v as PrintSettings["colorMode"])}>
                    <SelectTrigger data-testid="select-color-mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="color">Color</SelectItem>
                      <SelectItem value="bw">Black &amp; White</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <ToggleRow
                label="Copy labels"
                description="Print 'Original / Duplicate' copy labels."
                checked={form.copyLabels}
                onChange={(v) => set("copyLabels", v)}
                testId="switch-copy-labels"
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Document */}
        <TabsContent value="document">
          <Card>
            <CardContent className="pt-6">
              <ToggleRow label="Show logo" checked={form.showLogo} onChange={(v) => set("showLogo", v)} testId="switch-show-logo" />
              <ToggleRow label="Show QR / UPI" checked={form.showQr} onChange={(v) => set("showQr", v)} testId="switch-show-qr" />
              <ToggleRow label="Show bank details" checked={form.showBankDetails} onChange={(v) => set("showBankDetails", v)} testId="switch-show-bank" />
              <ToggleRow label="Show signature" checked={form.showSignature} onChange={(v) => set("showSignature", v)} testId="switch-show-signature" />
              <ToggleRow label="Show amount in words" checked={form.showAmountInWords} onChange={(v) => set("showAmountInWords", v)} testId="switch-show-words" />
              <ToggleRow label="Show HSN column (GST)" checked={form.showHsn} onChange={(v) => set("showHsn", v)} testId="switch-show-hsn" />
              <ToggleRow label="Show LTR column" checked={form.showLtrColumn} onChange={(v) => set("showLtrColumn", v)} testId="switch-show-ltr" />
              <ToggleRow label="Show BOX column" checked={form.showBoxColumn} onChange={(v) => set("showBoxColumn", v)} testId="switch-show-box" />
              <ToggleRow label="Show terms & conditions" checked={form.showTerms} onChange={(v) => set("showTerms", v)} testId="switch-show-terms" />
              <ToggleRow label="Filler rows" description="Pad short bills with empty rows." checked={form.fillerRows} onChange={(v) => set("fillerRows", v)} testId="switch-filler-rows" />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Header & Terms */}
        <TabsContent value="header">
          <Card>
            <CardContent className="space-y-4 pt-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label htmlFor="companyName">Company Name</Label>
                  <Input id="companyName" value={form.companyName} onChange={(e) => set("companyName", e.target.value)} data-testid="input-company-name" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="gstin">GSTIN</Label>
                  <Input id="gstin" value={form.gstin} onChange={(e) => set("gstin", e.target.value)} data-testid="input-gstin" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="addressLine">Address</Label>
                  <Input id="addressLine" value={form.addressLine} onChange={(e) => set("addressLine", e.target.value)} data-testid="input-address" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="contact">Contact</Label>
                  <Input id="contact" value={form.contact} onChange={(e) => set("contact", e.target.value)} data-testid="input-contact" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" value={form.email} onChange={(e) => set("email", e.target.value)} data-testid="input-email" />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="terms">Terms &amp; Conditions (one per line)</Label>
                <Textarea
                  id="terms"
                  rows={4}
                  value={(form.terms ?? []).join("\n")}
                  onChange={(e) => set("terms", e.target.value.split("\n"))}
                  data-testid="input-terms"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="footerNote">Footer Note</Label>
                <Input id="footerNote" value={form.footerNote} onChange={(e) => set("footerNote", e.target.value)} data-testid="input-footer-note" />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Default Printers */}
        <TabsContent value="printers">
          <Card>
            <CardContent className="space-y-4 pt-6">
              <p className="text-xs text-muted-foreground">
                These are best-effort labels — the browser's print dialog ultimately selects the
                physical printer. Use them to record which printer each paper size should go to.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label htmlFor="printerA4">A4 Printer</Label>
                  <Input id="printerA4" value={form.printerA4} onChange={(e) => set("printerA4", e.target.value)} data-testid="input-printer-a4" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="printerA5">A5 Printer</Label>
                  <Input id="printerA5" value={form.printerA5} onChange={(e) => set("printerA5", e.target.value)} data-testid="input-printer-a5" />
                </div>
                <div className="space-y-1">
                  <Label>Thermal Width</Label>
                  <Select value={form.thermalWidth} onValueChange={(v) => set("thermalWidth", v as PrintSettings["thermalWidth"])}>
                    <SelectTrigger data-testid="select-thermal-width">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="58mm">58 mm</SelectItem>
                      <SelectItem value="72mm">72 mm</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="border-t pt-4">
                <div className="mb-2 text-sm font-medium">Bank Details</div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label htmlFor="bankName">Bank Name</Label>
                    <Input id="bankName" value={form.bankName} onChange={(e) => set("bankName", e.target.value)} data-testid="input-bank-name" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="bankAccount">Account No.</Label>
                    <Input id="bankAccount" value={form.bankAccount} onChange={(e) => set("bankAccount", e.target.value)} data-testid="input-bank-account" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="bankIfsc">IFSC</Label>
                    <Input id="bankIfsc" value={form.bankIfsc} onChange={(e) => set("bankIfsc", e.target.value)} data-testid="input-bank-ifsc" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="bankBranch">Branch</Label>
                    <Input id="bankBranch" value={form.bankBranch} onChange={(e) => set("bankBranch", e.target.value)} data-testid="input-bank-branch" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="upiId">UPI ID</Label>
                    <Input id="upiId" value={form.upiId} onChange={(e) => set("upiId", e.target.value)} data-testid="input-upi-id" />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <InvoiceTemplateSelector
        open={selectorOpen}
        onOpenChange={setSelectorOpen}
        invoice={SAMPLE_INVOICE}
        maps={SAMPLE_MAPS}
        settings={form}
        value={form.defaultTemplate}
        onSelect={(id) => set("defaultTemplate", id)}
      />
    </div>
  );
}
