// Per-company print settings editor. Five tabs: General, Document, Header & Terms,
// Payment, Default Printers. Admin-only (the API enforces this on PUT).
//
// GST and Non-GST bills each have their own settings: the main settings are the
// GST bills'; Non-GST bills use their own copy (`nonGst`) once it is turned on,
// else the GST ones. Each kind of bill can also have its own logo (`billLogo`,
// blank = the Company Profile logo). The printers are shared.

import { useEffect, useRef, useState } from "react";
import {
  useGetPrintSettings,
  useUpdatePrintSettings,
  getGetPrintSettingsQueryKey,
  type PrintSettings as ApiPrintSettings,
  type PrintSettingsUpdate,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
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
import { Save, Eye, Upload, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { TEMPLATES } from "@/components/invoice-templates/registry";
import { InvoiceTemplateSelector } from "@/components/invoice-templates/InvoiceTemplateSelector";
import { SAMPLE_INVOICE, SAMPLE_MAPS } from "@/components/invoice-templates/sample";
import { PaymentQr } from "@/components/invoice-templates/parts";
import { useCompanyLogo } from "@/hooks/use-company-logo";
import type { NonGstPrintSettings } from "@/components/invoice-templates/types";
import { GstinFetchButton } from "@/components/gstin-fetch";

type PrintSettings = ApiPrintSettings & { billLogo?: string | null; nonGst?: NonGstPrintSettings | null };
type Scope = "gst" | "nonGst";
// Same for both kinds of bill — never copied into the Non-GST settings.
const SHARED_KEYS = new Set<string>(["printerA4", "printerA5", "thermalWidth", "nonGst"]);

const MAX_QR_IMAGE_BYTES = 500 * 1024;
const MAX_LOGO_IMAGE_BYTES = 500 * 1024;
const MAX_WATERMARK_IMAGE_BYTES = 500 * 1024;

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
  const logo = useCompanyLogo();
  const [scope, setScope] = useState<Scope>("gst");
  const qrFileRef = useRef<HTMLInputElement>(null);
  const logoFileRef = useRef<HTMLInputElement>(null);
  const watermarkFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (data && !dirty) setForm(data as PrintSettings);
  }, [data, dirty]);

  if (isLoading || !form) {
    return <div className="py-8 text-center text-muted-foreground">Loading print settings...</div>;
  }

  const nonGstOn = !!form.nonGst?.enabled;
  // What the tabs show and edit: the GST settings, or the Non-GST ones.
  const view: PrintSettings = scope === "gst" ? form : { ...form, ...(form.nonGst ?? {}) };

  const set = <K extends keyof PrintSettings>(key: K, value: PrintSettings[K]) => {
    setForm((prev) => {
      if (!prev) return prev;
      if (scope === "nonGst" && !SHARED_KEYS.has(key as string)) {
        return { ...prev, nonGst: { ...(prev.nonGst ?? {}), [key]: value } };
      }
      return { ...prev, [key]: value };
    });
    setDirty(true);
  };

  // Turning Non-GST settings on starts them as a copy of the GST ones.
  const setNonGstOn = (on: boolean) => {
    setForm((prev) => {
      if (!prev) return prev;
      if (!on) return { ...prev, nonGst: { ...(prev.nonGst ?? {}), enabled: false } };
      if (prev.nonGst) return { ...prev, nonGst: { ...prev.nonGst, enabled: true } };
      const copy: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(prev)) if (!SHARED_KEYS.has(k)) copy[k] = v;
      return { ...prev, nonGst: { ...(copy as NonGstPrintSettings), enabled: true } };
    });
    setDirty(true);
  };

  const handleLogoFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file", description: "Please choose an image file.", variant: "destructive" });
      return;
    }
    if (file.size > MAX_LOGO_IMAGE_BYTES) {
      toast({ title: "File too large", description: "Logo must be under 500 KB.", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => set("billLogo", reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleQrFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file", description: "Please choose an image file.", variant: "destructive" });
      return;
    }
    if (file.size > MAX_QR_IMAGE_BYTES) {
      toast({ title: "File too large", description: "QR image must be under 500 KB.", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => set("qrImage", reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleWatermarkFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file", description: "Please choose an image file.", variant: "destructive" });
      return;
    }
    if (file.size > MAX_WATERMARK_IMAGE_BYTES) {
      toast({ title: "File too large", description: "Watermark image must be under 500 KB.", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => set("watermarkImage", reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleSave = () => {
    if (!form) return;
    const payload = { ...form } as PrintSettingsUpdate;
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

  const defaultMeta = TEMPLATES.find((t) => t.id === view.defaultTemplate);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
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

      <div className="flex flex-wrap items-center gap-2">
        <Button variant={scope === "gst" ? "default" : "outline"} size="sm" onClick={() => setScope("gst")} data-testid="button-scope-gst">
          GST bills
        </Button>
        <Button variant={scope === "nonGst" ? "default" : "outline"} size="sm" onClick={() => setScope("nonGst")} data-testid="button-scope-non-gst">
          Non-GST bills
        </Button>
        <span className="text-xs text-muted-foreground">
          {scope === "gst" ? "What prints on GST bills." : nonGstOn ? "What prints on Non-GST bills." : "Non-GST bills print with the GST settings."}
        </span>
      </div>

      {scope === "nonGst" && (
        <Card>
          <CardContent className="pt-6">
            <ToggleRow
              label="Separate settings for Non-GST bills"
              description="Their own logo, name, address, terms, QR, template and what to show. Off = same as GST bills."
              checked={nonGstOn}
              onChange={setNonGstOn}
              testId="switch-non-gst-own"
            />
          </CardContent>
        </Card>
      )}

      {(scope === "gst" || nonGstOn) && (
      <Tabs defaultValue="general">
        <TabsList className="flex flex-wrap h-auto w-full justify-start gap-1">
          <TabsTrigger value="general" data-testid="tab-print-general">General</TabsTrigger>
          <TabsTrigger value="document" data-testid="tab-print-document">Document</TabsTrigger>
          <TabsTrigger value="header" data-testid="tab-print-header">Header &amp; Terms</TabsTrigger>
          <TabsTrigger value="payment" data-testid="tab-print-payment">Payment</TabsTrigger>
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
                      {defaultMeta ? `${defaultMeta.name} (${defaultMeta.paper})` : view.defaultTemplate}
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setSelectorOpen(true)}>
                      Change
                    </Button>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="copies">Copies</Label>
                  <NumberInput
                    id="copies"
                    min={1}
                    max={5}
                    emptyValue={1}
                    value={view.copies}
                    onChange={(v) => set("copies", Math.max(1, v || 1))}
                    data-testid="input-copies"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Color Mode</Label>
                  <Select value={view.colorMode} onValueChange={(v) => set("colorMode", v as PrintSettings["colorMode"])}>
                    <SelectTrigger data-testid="select-color-mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="color">Color</SelectItem>
                      <SelectItem value="bw">Black &amp; White</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Paper Size</Label>
                  <Select value={view.paperSize} onValueChange={(v) => set("paperSize", v as PrintSettings["paperSize"])}>
                    <SelectTrigger data-testid="select-paper-size">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto (match template)</SelectItem>
                      <SelectItem value="A4">A4</SelectItem>
                      <SelectItem value="A5">A5</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Orientation</Label>
                  <Select value={view.orientation} onValueChange={(v) => set("orientation", v as PrintSettings["orientation"])}>
                    <SelectTrigger data-testid="select-orientation">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto (match template)</SelectItem>
                      <SelectItem value="portrait">Portrait</SelectItem>
                      <SelectItem value="landscape">Landscape</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Overrides the template's default for printing/PDF. Leave on Auto unless your printer needs a specific size.
                  </p>
                </div>
              </div>
              <ToggleRow
                label="Copy labels"
                description="Print 'Original / Duplicate' copy labels."
                checked={view.copyLabels}
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
              <ToggleRow label="Show logo" checked={view.showLogo} onChange={(v) => set("showLogo", v)} testId="switch-show-logo" />
              <div className="border-b py-3">
                <div className="mb-2 text-sm font-medium">{scope === "gst" ? "Logo on GST bills" : "Logo on Non-GST bills"}</div>
                <div className="flex items-center gap-4">
                  {view.billLogo || logo ? (
                    <img src={(view.billLogo || logo)!} alt="Bill logo" className="h-16 max-w-[160px] w-auto object-contain" />
                  ) : (
                    <div className="h-16 w-16 rounded border border-dashed flex items-center justify-center text-[10px] text-muted-foreground text-center px-1">
                      No logo
                    </div>
                  )}
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => logoFileRef.current?.click()} data-testid="button-upload-bill-logo">
                        <Upload className="h-3.5 w-3.5 mr-1.5" /> {view.billLogo ? "Replace logo" : "Upload logo"}
                      </Button>
                      {view.billLogo && (
                        <Button variant="ghost" size="sm" onClick={() => set("billLogo", null)} data-testid="button-remove-bill-logo">
                          <X className="h-3.5 w-3.5 mr-1.5" /> Remove
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground max-w-sm">
                      {view.billLogo
                        ? "Printed at the top of the bill, beside the name, as it is (no circle)."
                        : logo
                          ? "Using the Company Profile logo. Upload one here to print a different logo on these bills."
                          : "No logo yet. Upload one to print it at the top of these bills."}
                    </p>
                  </div>
                  <input
                    ref={logoFileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/webp"
                    className="hidden"
                    onChange={(e) => { handleLogoFile(e.target.files?.[0]); e.target.value = ""; }}
                  />
                </div>
              </div>
              <ToggleRow
                label="Show QR / UPI"
                description="Configure the QR code and bank details on the Payment tab."
                checked={view.showQr}
                onChange={(v) => set("showQr", v)}
                testId="switch-show-qr"
              />
              <ToggleRow
                label="Show bank details"
                description="Configure bank details on the Payment tab."
                checked={view.showBankDetails}
                onChange={(v) => set("showBankDetails", v)}
                testId="switch-show-bank"
              />
              <ToggleRow label="Show signature" checked={view.showSignature} onChange={(v) => set("showSignature", v)} testId="switch-show-signature" />
              <ToggleRow label="Show amount in words" checked={view.showAmountInWords} onChange={(v) => set("showAmountInWords", v)} testId="switch-show-words" />
              {scope === "gst" && (
                <ToggleRow label="Show HSN column (GST)" checked={view.showHsn} onChange={(v) => set("showHsn", v)} testId="switch-show-hsn" />
              )}
              <ToggleRow label="Show LTR/KGS column" checked={view.showLtrColumn} onChange={(v) => set("showLtrColumn", v)} testId="switch-show-ltr" />
              <ToggleRow label="Show BOX column" checked={view.showBoxColumn} onChange={(v) => set("showBoxColumn", v)} testId="switch-show-box" />
              <ToggleRow label="Show terms & conditions" checked={view.showTerms} onChange={(v) => set("showTerms", v)} testId="switch-show-terms" />
              <ToggleRow label="Filler rows" description="Pad short bills with empty rows." checked={view.fillerRows} onChange={(v) => set("fillerRows", v)} testId="switch-filler-rows" />
              <ToggleRow
                label="Show watermark"
                description="Faint background image/logo behind the invoice content."
                checked={view.showWatermark}
                onChange={(v) => set("showWatermark", v)}
                testId="switch-show-watermark"
              />

              <div className="border-t pt-4 mt-1">
                <div className="mb-2 text-sm font-medium">Watermark Image</div>
                <div className="flex items-center gap-4">
                  {view.watermarkImage ? (
                    <img
                      src={view.watermarkImage}
                      alt="Watermark preview"
                      className="h-16 w-16 rounded border object-contain bg-muted/30"
                    />
                  ) : (
                    <div className="h-16 w-16 rounded border border-dashed flex items-center justify-center text-[10px] text-muted-foreground text-center px-1">
                      No image
                    </div>
                  )}
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => watermarkFileRef.current?.click()} data-testid="button-upload-watermark">
                        <Upload className="h-3.5 w-3.5 mr-1.5" /> {view.watermarkImage ? "Replace watermark" : "Upload watermark"}
                      </Button>
                      {view.watermarkImage && (
                        <Button variant="ghost" size="sm" onClick={() => set("watermarkImage", null)} data-testid="button-remove-watermark">
                          <X className="h-3.5 w-3.5 mr-1.5" /> Remove
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground max-w-sm">
                      Shown faded behind the invoice content when "Show watermark" is on. Use your logo or a "COPY" / "PAID" stamp.
                    </p>
                  </div>
                  <input
                    ref={watermarkFileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/webp"
                    className="hidden"
                    onChange={(e) => { handleWatermarkFile(e.target.files?.[0]); e.target.value = ""; }}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Header & Terms */}
        <TabsContent value="header">
          <Card>
            <CardContent className="space-y-4 pt-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label htmlFor="companyName">Company / Shop Name</Label>
                  <Input id="companyName" value={view.companyName} onChange={(e) => set("companyName", e.target.value)} data-testid="input-company-name" />
                  <p className="text-xs text-muted-foreground">Shown on Non-GST bills, and on GST bills if no GST legal name is set below.</p>
                </div>
                {scope === "gst" && (<>
                <div className="space-y-1">
                  <Label htmlFor="gstLegalName">GST Legal Name <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <Input
                    id="gstLegalName"
                    value={view.gstLegalName ?? ""}
                    onChange={(e) => set("gstLegalName", e.target.value)}
                    placeholder="Leave blank to use Company / Shop Name above"
                    data-testid="input-gst-legal-name"
                  />
                  <p className="text-xs text-muted-foreground">Shown instead of the name above only on GST bills — for when your GST registration is under a different name than your shop.</p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="gstin">GSTIN</Label>
                  <div className="flex gap-1">
                    <Input id="gstin" value={view.gstin} onChange={(e) => set("gstin", e.target.value.toUpperCase())} data-testid="input-gstin" />
                    <GstinFetchButton
                      gstin={view.gstin}
                      onFetched={(d) => {
                        if (!d.found) return;
                        // The shop name stays as typed; the registered names fill blanks.
                        if (!view.companyName.trim() && (d.tradeName || d.legalName)) set("companyName", (d.tradeName || d.legalName)!);
                        if (d.legalName && d.legalName !== (view.companyName.trim() || d.tradeName)) set("gstLegalName", d.legalName);
                        if (d.address) set("addressLine", d.address);
                      }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">Fetch fills the GST legal name and address from the GST registry.</p>
                </div>
                </>)}
                <div className="space-y-1">
                  <Label htmlFor="addressLine">Address</Label>
                  <Input id="addressLine" value={view.addressLine} onChange={(e) => set("addressLine", e.target.value)} data-testid="input-address" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="contact">Contact</Label>
                  <Input id="contact" value={view.contact} onChange={(e) => set("contact", e.target.value)} data-testid="input-contact" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" value={view.email} onChange={(e) => set("email", e.target.value)} data-testid="input-email" />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="terms">Terms &amp; Conditions (one per line)</Label>
                <Textarea
                  id="terms"
                  rows={4}
                  value={(view.terms ?? []).join("\n")}
                  onChange={(e) => set("terms", e.target.value.split("\n"))}
                  placeholder={"Goods once sold will not be taken back.\nSubject to <your city> jurisdiction."}
                  data-testid="input-terms"
                />
                <p className="text-xs text-muted-foreground">Printed on GST and Non-GST bills. Add your own line such as "Subject to &lt;your city&gt; jurisdiction."</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="footerNote">Footer Note</Label>
                <Input id="footerNote" value={view.footerNote} onChange={(e) => set("footerNote", e.target.value)} data-testid="input-footer-note" />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Payment */}
        <TabsContent value="payment">
          <Card>
            <CardContent className="space-y-4 pt-6">
              <div>
                <div className="mb-2 text-sm font-medium">Bank Details</div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label htmlFor="bankName">Bank Name</Label>
                    <Input id="bankName" value={view.bankName} onChange={(e) => set("bankName", e.target.value)} data-testid="input-bank-name" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="bankAccount">Account No.</Label>
                    <Input id="bankAccount" value={view.bankAccount} onChange={(e) => set("bankAccount", e.target.value)} data-testid="input-bank-account" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="bankIfsc">IFSC</Label>
                    <Input id="bankIfsc" value={view.bankIfsc} onChange={(e) => set("bankIfsc", e.target.value)} data-testid="input-bank-ifsc" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="bankBranch">Branch</Label>
                    <Input id="bankBranch" value={view.bankBranch} onChange={(e) => set("bankBranch", e.target.value)} data-testid="input-bank-branch" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="upiId">UPI ID</Label>
                    <Input id="upiId" value={view.upiId} onChange={(e) => set("upiId", e.target.value)} data-testid="input-upi-id" />
                  </div>
                </div>
              </div>

              <div className="border-t pt-4">
                <div className="mb-2 text-sm font-medium">QR Code</div>
                <div className="flex items-center gap-4">
                  <PaymentQr invoice={SAMPLE_INVOICE} settings={view} size={72} />
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => qrFileRef.current?.click()} data-testid="button-upload-qr">
                        <Upload className="h-3.5 w-3.5 mr-1.5" /> {view.qrImage ? "Replace QR image" : "Upload custom QR"}
                      </Button>
                      {view.qrImage && (
                        <Button variant="ghost" size="sm" onClick={() => set("qrImage", null)} data-testid="button-remove-qr">
                          <X className="h-3.5 w-3.5 mr-1.5" /> Remove
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground max-w-sm">
                      {view.qrImage
                        ? "Using your uploaded image. Remove it to switch back to an auto-generated QR."
                        : "Auto-generated from the UPI ID above and each invoice's total. Or upload your own QR (from your bank, Paytm, PhonePe, etc.) to use that instead."}
                    </p>
                  </div>
                  <input
                    ref={qrFileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/webp"
                    className="hidden"
                    onChange={(e) => { handleQrFile(e.target.files?.[0]); e.target.value = ""; }}
                  />
                </div>
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
                  <Input id="printerA4" value={view.printerA4} onChange={(e) => set("printerA4", e.target.value)} data-testid="input-printer-a4" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="printerA5">A5 Printer</Label>
                  <Input id="printerA5" value={view.printerA5} onChange={(e) => set("printerA5", e.target.value)} data-testid="input-printer-a5" />
                </div>
                <div className="space-y-1">
                  <Label>Thermal Width</Label>
                  <Select value={view.thermalWidth} onValueChange={(v) => set("thermalWidth", v as PrintSettings["thermalWidth"])}>
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
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      )}

      <InvoiceTemplateSelector
        open={selectorOpen}
        onOpenChange={setSelectorOpen}
        invoice={SAMPLE_INVOICE}
        maps={SAMPLE_MAPS}
        settings={{ ...view, logo: view.billLogo || logo }}
        value={view.defaultTemplate}
        onSelect={(id) => set("defaultTemplate", id)}
      />
    </div>
  );
}
