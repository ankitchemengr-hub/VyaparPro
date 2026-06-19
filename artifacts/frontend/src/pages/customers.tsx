import React, { useState } from "react";
import { useForm } from "react-hook-form";
import {
  useListEntities,
  useCreateEntity,
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
import { Search, UserPlus, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

type FilterType = EntityType | "all";

const TYPE_LABELS: Record<EntityType, string> = {
  customer: "Customer",
  vendor: "Vendor",
  worker: "Worker",
  salesman: "Salesman",
};

export default function Customers() {
  const [search, setSearch] = useState("");
  const [type, setType] = useState<FilterType>("customer");
  const [showAdd, setShowAdd] = useState(false);
  const [assignedSalesmanId, setAssignedSalesmanId] = useState<string>("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: entities, isLoading } = useListEntities({
    type: type !== "all" ? (type as EntityType) : undefined,
    search: search || undefined,
  });

  const { data: salesmanEntities } = useListEntities({ type: "salesman" as EntityType });

  const createEntity = useCreateEntity();

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

  const formType = form.watch("type");
  const isCustomerForm = formType === "customer";
  const needsName = isCustomerForm && form.watch("pricingTier") === "retail" ? false : true;

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
                <TableHead className="text-right">Balance</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">Loading...</TableCell>
                </TableRow>
              ) : entities?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No entities found.</TableCell>
                </TableRow>
              ) : (
                entities?.map((entity) => (
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
                    <TableCell className="text-right font-bold">
                      <span className={entity.outstandingBalance && entity.outstandingBalance > 0 ? "text-destructive" : "text-green-600"}>
                        ₹{Math.abs(entity.outstandingBalance || 0).toLocaleString()}
                        {entity.outstandingBalance && entity.outstandingBalance > 0 ? " Dr" : " Cr"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
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
                            <Input data-testid="input-add-entity-gstin" placeholder="Optional" {...field} />
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
    </div>
  );
}
