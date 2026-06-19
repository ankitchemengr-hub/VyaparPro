import React, { useState } from "react";
import { useForm } from "react-hook-form";
import {
  useListEntities,
  useCreateEntity,
  useUpdateEntity,
  getListEntitiesQueryKey,
  EntityType,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Link } from "wouter";
import { Search, UserPlus, Pencil, Loader2, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

type FilterType = EntityType | "all";

const TYPE_LABELS: Record<EntityType, string> = {
  customer: "Customer",
  vendor: "Vendor",
  worker: "Worker",
  salesman: "Salesman",
};

type EditFormValues = {
  name: string;
  mobile: string;
  gstin: string;
  address: string;
  city: string;
  state: string;
  district: string;
  area: string;
  pinCode: string;
  gpsLocation: string;
  pricingTier: "retail" | "wholesale";
};

export default function Customers() {
  const [search, setSearch] = useState("");
  const [type, setType] = useState<FilterType>("customer");
  const [sort, setSort] = useState("name_asc");
  const [showAdd, setShowAdd] = useState(false);
  const [assignedSalesmanId, setAssignedSalesmanId] = useState<string>("");

  const [editingEntity, setEditingEntity] = useState<any | null>(null);
  const [editSalesmanId, setEditSalesmanId] = useState<string>("");
  const [gstFetching, setGstFetching] = useState(false);
  const [gstFetchingEdit, setGstFetchingEdit] = useState(false);

  const fetchGstinDetails = async (gstin: string, targetForm: "add" | "edit") => {
    const val = gstin.trim().toUpperCase();
    if (!val) { toast({ title: "Enter a GSTIN first", variant: "destructive" }); return; }
    const setFetching = targetForm === "add" ? setGstFetching : setGstFetchingEdit;
    setFetching(true);
    try {
      const res = await fetch(`/api/gstin-lookup?gstin=${encodeURIComponent(val)}`, { credentials: "include" });
      const data = await res.json();
      if (!data.found) {
        toast({ title: "Not found", description: data.error ?? "GSTIN not found in registry.", variant: "destructive" });
        if (data.state) {
          if (targetForm === "add") form.setValue("state", data.state);
          else editForm.setValue("state", data.state);
        }
        return;
      }
      const name = data.tradeName || data.legalName || "";
      if (targetForm === "add") {
        if (name) form.setValue("name", name);
        if (data.address) form.setValue("address", data.address);
        if (data.state) form.setValue("state", data.state);
        if (data.pinCode) form.setValue("pinCode", data.pinCode);
      } else {
        if (name) editForm.setValue("name", name);
        if (data.address) editForm.setValue("address", data.address);
        if (data.state) editForm.setValue("state", data.state);
        if (data.pinCode) editForm.setValue("pinCode", data.pinCode);
      }
      toast({ title: "Details fetched", description: `${name || data.gstin} — ${data.state ?? ""}` });
    } catch {
      toast({ title: "Fetch failed", description: "Could not reach GST registry.", variant: "destructive" });
    } finally {
      setFetching(false);
    }
  };

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: entities, isLoading } = useListEntities({
    type: type !== "all" ? (type as EntityType) : undefined,
    search: search || undefined,
  });

  const { data: salesmanEntities } = useListEntities({ type: "salesman" as EntityType });

  const createEntity = useCreateEntity();
  const updateEntity = useUpdateEntity();

  const form = useForm({
    defaultValues: {
      type: (type !== "all" ? type : "customer") as EntityType,
      name: "",
      mobile: "",
      gstin: "",
      address: "",
      city: "",
      state: "Maharashtra",
      district: "",
      area: "",
      pinCode: "",
      gpsLocation: "",
      pricingTier: "retail" as "retail" | "wholesale",
    },
  });

  const editForm = useForm<EditFormValues>({
    defaultValues: {
      name: "",
      mobile: "",
      gstin: "",
      address: "",
      city: "",
      state: "",
      district: "",
      area: "",
      pinCode: "",
      gpsLocation: "",
      pricingTier: "retail",
    },
  });

  const openAdd = () => {
    form.reset({
      type: (type !== "all" ? type : "customer") as EntityType,
      name: "",
      mobile: "",
      gstin: "",
      address: "",
      city: "",
      state: "Maharashtra",
      district: "",
      area: "",
      pinCode: "",
      gpsLocation: "",
      pricingTier: "retail",
    });
    setAssignedSalesmanId("");
    setShowAdd(true);
  };

  const openEdit = (entity: any) => {
    setEditingEntity(entity);
    editForm.reset({
      name: entity.name || "",
      mobile: entity.mobile || "",
      gstin: entity.gstin || "",
      address: entity.address || "",
      city: entity.city || "",
      state: entity.state || "",
      district: entity.district || "",
      area: entity.area || "",
      pinCode: entity.pinCode || "",
      gpsLocation: entity.gpsLocation || "",
      pricingTier: entity.pricingTier === "wholesale" ? "wholesale" : "retail",
    });
    setEditSalesmanId(entity.assignedSalesmanId ? String(entity.assignedSalesmanId) : "");
  };

  const onSubmit = form.handleSubmit((data) => {
    const isCustomer = data.type === "customer";
    const payload: any = {
      type: data.type,
      name: data.name.trim() || undefined,
      mobile: data.mobile.trim(),
      gstin: data.gstin?.trim() || undefined,
      address: data.address?.trim() || undefined,
      city: data.city?.trim() || undefined,
      state: data.state?.trim() || undefined,
      district: data.district?.trim() || undefined,
      area: data.area?.trim() || undefined,
      pinCode: data.pinCode?.trim() || undefined,
      gpsLocation: data.gpsLocation?.trim() || undefined,
    };
    if (isCustomer) payload.pricingTier = data.pricingTier;
    if (isCustomer && assignedSalesmanId) payload.assignedSalesmanId = Number(assignedSalesmanId);

    createEntity.mutate(
      { data: payload },
      {
        onSuccess: (created) => {
          queryClient.invalidateQueries({ queryKey: getListEntitiesQueryKey() });
          toast({
            title: `${TYPE_LABELS[data.type]} added`,
            description: `${created.name} registered successfully.`,
          });
          setShowAdd(false);
        },
        onError: async (err: any) => {
          let msg = err?.message ?? "Failed to add entity";
          try {
            const j = await err?.response?.json?.();
            if (j?.error) msg = String(j.error).slice(0, 300);
          } catch {}
          toast({ title: "Add failed", description: msg, variant: "destructive" });
        },
      }
    );
  });

  const onEditSubmit = editForm.handleSubmit((data) => {
    if (!editingEntity) return;
    const isCustomer = editingEntity.type === "customer";
    const payload: any = {
      name: data.name.trim() || undefined,
      mobile: data.mobile.trim(),
      gstin: data.gstin?.trim() || undefined,
      address: data.address?.trim() || undefined,
      city: data.city?.trim() || undefined,
      state: data.state?.trim() || undefined,
      district: data.district?.trim() || undefined,
      area: data.area?.trim() || undefined,
      pinCode: data.pinCode?.trim() || undefined,
      gpsLocation: data.gpsLocation?.trim() || undefined,
    };
    if (isCustomer) {
      payload.pricingTier = data.pricingTier;
      payload.assignedSalesmanId = editSalesmanId ? Number(editSalesmanId) : null;
    }

    updateEntity.mutate(
      { id: editingEntity.id, data: payload },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListEntitiesQueryKey() });
          toast({ title: "Saved", description: `${editingEntity.name} updated successfully.` });
          setEditingEntity(null);
        },
        onError: async (err: any) => {
          let msg = err?.message ?? "Failed to update";
          try {
            const j = await err?.response?.json?.();
            if (j?.error) msg = String(j.error).slice(0, 300);
          } catch {}
          toast({ title: "Update failed", description: msg, variant: "destructive" });
        },
      }
    );
  });

  const formType = form.watch("type");
  const isCustomerForm = formType === "customer";
  const needsName = isCustomerForm && form.watch("pricingTier") === "retail" ? false : true;

  const salesmanName = (id: number | null | undefined) => {
    if (!id) return null;
    return salesmanEntities?.find((s) => s.id === id)?.name ?? `#${id}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Entity Directory</h1>
        <Button onClick={openAdd} data-testid="button-open-add-entity">
          <UserPlus className="mr-2 h-4 w-4" /> Add Entity
        </Button>
      </div>

      <div className="flex gap-4">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search name or mobile..."
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={type} onValueChange={(v) => setType(v as FilterType)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Entity Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="customer">Customers</SelectItem>
            <SelectItem value="vendor">Vendors</SelectItem>
            <SelectItem value="worker">Workers</SelectItem>
            <SelectItem value="salesman">Salesmen</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger className="w-[190px]">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name_asc">Name A → Z</SelectItem>
            <SelectItem value="name_desc">Name Z → A</SelectItem>
            <SelectItem value="balance_high">Balance High → Low</SelectItem>
            <SelectItem value="balance_low">Balance Low → High</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Mobile</TableHead>
                <TableHead>Pricing Tier</TableHead>
                <TableHead>Salesman</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">Loading...</TableCell>
                </TableRow>
              ) : entities?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No entities found.</TableCell>
                </TableRow>
              ) : (
                [...(entities ?? [])].sort((a, b) => {
                  if (sort === "name_asc") return (a.name ?? "").localeCompare(b.name ?? "");
                  if (sort === "name_desc") return (b.name ?? "").localeCompare(a.name ?? "");
                  if (sort === "balance_high") return (b.outstandingBalance ?? 0) - (a.outstandingBalance ?? 0);
                  if (sort === "balance_low") return (a.outstandingBalance ?? 0) - (b.outstandingBalance ?? 0);
                  return 0;
                }).map((entity) => (
                  <TableRow key={entity.id} data-testid={`row-entity-${entity.id}`}>
                    <TableCell className="font-medium">
                      <Link href={`/customers/${entity.id}`} className="text-primary hover:underline">
                        {entity.name}
                      </Link>
                    </TableCell>
                    <TableCell className="capitalize">{entity.type}</TableCell>
                    <TableCell>{entity.mobile}</TableCell>
                    <TableCell>
                      {entity.pricingTier && <Badge variant="outline" className="capitalize">{entity.pricingTier}</Badge>}
                    </TableCell>
                    <TableCell>
                      {(entity as any).assignedSalesmanId
                        ? <span className="text-sm text-muted-foreground">{salesmanName((entity as any).assignedSalesmanId)}</span>
                        : <span className="text-xs text-muted-foreground italic">—</span>}
                    </TableCell>
                    <TableCell className="text-right font-bold">
                      <span className={entity.outstandingBalance && entity.outstandingBalance > 0 ? "text-destructive" : "text-green-600"}>
                        ₹{Math.abs(entity.outstandingBalance || 0).toLocaleString()}
                        {entity.outstandingBalance && entity.outstandingBalance > 0 ? " Dr" : " Cr"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(entity)}>
                        <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
                      </Button>
                      <Link href={`/customers/${entity.id}`}>
                        <Button variant="ghost" size="sm">View Ledger</Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ── ADD DIALOG ─────────────────────────────────── */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-primary" />
              Add {TYPE_LABELS[formType] || "Entity"}
            </DialogTitle>
            <DialogDescription>
              {formType === "salesman"
                ? "Register a salesman entity. To let them log into the app, an admin must also create a matching user account."
                : formType === "worker"
                ? "Register a worker for manufacturing / job-card assignment."
                : formType === "vendor"
                ? "Register a vendor for purchase / supplier records."
                : "Register a customer for billing and ledger tracking."}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={onSubmit} className="space-y-3">
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Entity Type *</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger data-testid="select-add-entity-type">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="customer">Customer</SelectItem>
                        <SelectItem value="vendor">Vendor</SelectItem>
                        <SelectItem value="worker">Worker</SelectItem>
                        <SelectItem value="salesman">Salesman</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="name"
                  rules={{
                    validate: (v) =>
                      needsName && !v?.trim() ? `Name is required for ${TYPE_LABELS[formType].toLowerCase()}s` : true,
                  }}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Name {needsName ? "*" : <span className="font-normal text-muted-foreground">(optional)</span>}
                      </FormLabel>
                      <FormControl>
                        <Input data-testid="input-add-entity-name" placeholder="Full name" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="mobile"
                  rules={{
                    required: "Mobile is required",
                    pattern: { value: /^\d{10}$/, message: "Mobile number must be exactly 10 digits" },
                  }}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Mobile *</FormLabel>
                      <FormControl>
                        <Input
                          data-testid="input-add-entity-mobile"
                          placeholder="9876543210"
                          inputMode="numeric"
                          maxLength={10}
                          {...field}
                          onChange={(e) => field.onChange(e.target.value.replace(/\D/g, "").slice(0, 10))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {isCustomerForm && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField
                      control={form.control}
                      name="pricingTier"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Pricing Tier</FormLabel>
                          <Select value={field.value} onValueChange={field.onChange}>
                            <FormControl>
                              <SelectTrigger data-testid="select-add-entity-tier">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="retail">Retail</SelectItem>
                              <SelectItem value="wholesale">Wholesale</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="gstin"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>GSTIN</FormLabel>
                          <FormControl>
                            <div className="flex gap-2">
                              <Input data-testid="input-add-entity-gstin" placeholder="Optional" {...field} className="uppercase" />
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="shrink-0 whitespace-nowrap"
                                disabled={gstFetching}
                                onClick={() => fetchGstinDetails(field.value, "add")}
                              >
                                {gstFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
                                {gstFetching ? "" : "Fetch"}
                              </Button>
                            </div>
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Assigned Salesman</label>
                    <Select
                      value={assignedSalesmanId || "__none__"}
                      onValueChange={(v) => setAssignedSalesmanId(v === "__none__" ? "" : v)}
                    >
                      <SelectTrigger className="mt-1.5" data-testid="select-assigned-salesman">
                        <SelectValue placeholder="None (no salesman)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">None</SelectItem>
                        {salesmanEntities?.map((s) => (
                          <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {assignedSalesmanId && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Commission from this customer's invoices will be attributed to the selected salesman for 1 year.
                      </p>
                    )}
                  </div>
                </>
              )}

              <FormField
                control={form.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Address</FormLabel>
                    <FormControl>
                      <Input data-testid="input-add-entity-address" placeholder="Street address (optional)" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="city"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>City</FormLabel>
                      <FormControl>
                        <Input data-testid="input-add-entity-city" placeholder="City" {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="state"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>State</FormLabel>
                      <FormControl>
                        <Input data-testid="input-add-entity-state" placeholder="State" {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="district"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>District</FormLabel>
                      <FormControl>
                        <Input data-testid="input-add-entity-district" placeholder="District" {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="area"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Area</FormLabel>
                      <FormControl>
                        <Input data-testid="input-add-entity-area" placeholder="Area" {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="pinCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>PIN Code</FormLabel>
                      <FormControl>
                        <Input data-testid="input-add-entity-pinCode" placeholder="PIN Code" {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="gpsLocation"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>GPS Location</FormLabel>
                      <FormControl>
                        <Input data-testid="input-add-entity-gpsLocation" placeholder="GPS Location" {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>

              <DialogFooter className="pt-2">
                <Button type="button" variant="outline" onClick={() => setShowAdd(false)} disabled={createEntity.isPending}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createEntity.isPending} data-testid="button-submit-add-entity">
                  {createEntity.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <UserPlus className="w-4 h-4 mr-2" />}
                  Add {TYPE_LABELS[formType]}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ── EDIT DIALOG ─────────────────────────────────── */}
      <Dialog open={!!editingEntity} onOpenChange={(open) => { if (!open) setEditingEntity(null); }}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="w-5 h-5 text-primary" />
              Edit {editingEntity ? TYPE_LABELS[editingEntity.type as EntityType] ?? editingEntity.type : "Entity"}
            </DialogTitle>
            <DialogDescription>
              Update details for <strong>{editingEntity?.name}</strong>.
              {editingEntity?.type === "customer" && " You can reassign the salesman here — changing this updates future commission attribution."}
            </DialogDescription>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={onEditSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={editForm.control}
                  name="name"
                  rules={{ required: "Name is required" }}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name *</FormLabel>
                      <FormControl>
                        <Input placeholder="Full name" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editForm.control}
                  name="mobile"
                  rules={{
                    required: "Mobile is required",
                    pattern: { value: /^\d{10}$/, message: "Must be 10 digits" },
                  }}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Mobile *</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="9876543210"
                          inputMode="numeric"
                          maxLength={10}
                          {...field}
                          onChange={(e) => field.onChange(e.target.value.replace(/\D/g, "").slice(0, 10))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {editingEntity?.type === "customer" && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField
                      control={editForm.control}
                      name="pricingTier"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Pricing Tier</FormLabel>
                          <Select value={field.value} onValueChange={field.onChange}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="retail">Retail</SelectItem>
                              <SelectItem value="wholesale">Wholesale</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={editForm.control}
                      name="gstin"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>GSTIN</FormLabel>
                          <FormControl>
                            <div className="flex gap-2">
                              <Input placeholder="Optional" {...field} className="uppercase" />
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="shrink-0 whitespace-nowrap"
                                disabled={gstFetchingEdit}
                                onClick={() => fetchGstinDetails(field.value, "edit")}
                              >
                                {gstFetchingEdit ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
                                {gstFetchingEdit ? "" : "Fetch"}
                              </Button>
                            </div>
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>

                  <div>
                    <label className="text-sm font-medium">Assigned Salesman</label>
                    <Select
                      value={editSalesmanId || "__none__"}
                      onValueChange={(v) => setEditSalesmanId(v === "__none__" ? "" : v)}
                    >
                      <SelectTrigger className="mt-1.5">
                        <SelectValue placeholder="None" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">None (remove assignment)</SelectItem>
                        {salesmanEntities?.map((s) => (
                          <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {editSalesmanId && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Future invoices for this customer will generate commission for the selected salesman.
                      </p>
                    )}
                  </div>
                </>
              )}

              <FormField
                control={editForm.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Address</FormLabel>
                    <FormControl>
                      <Input placeholder="Street address" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={editForm.control}
                  name="city"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>City</FormLabel>
                      <FormControl><Input placeholder="City" {...field} /></FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={editForm.control}
                  name="state"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>State</FormLabel>
                      <FormControl><Input placeholder="State" {...field} /></FormControl>
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={editForm.control}
                  name="district"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>District</FormLabel>
                      <FormControl><Input placeholder="District" {...field} /></FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={editForm.control}
                  name="area"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Area</FormLabel>
                      <FormControl><Input placeholder="Area" {...field} /></FormControl>
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={editForm.control}
                  name="pinCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>PIN Code</FormLabel>
                      <FormControl><Input placeholder="PIN Code" {...field} /></FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={editForm.control}
                  name="gpsLocation"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>GPS Location</FormLabel>
                      <FormControl><Input placeholder="GPS Location" {...field} /></FormControl>
                    </FormItem>
                  )}
                />
              </div>

              <DialogFooter className="pt-2">
                <Button type="button" variant="outline" onClick={() => setEditingEntity(null)} disabled={updateEntity.isPending}>
                  Cancel
                </Button>
                <Button type="submit" disabled={updateEntity.isPending}>
                  {updateEntity.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Pencil className="w-4 h-4 mr-2" />}
                  Save Changes
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
