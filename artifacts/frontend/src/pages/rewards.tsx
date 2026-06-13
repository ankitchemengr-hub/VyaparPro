import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { useAuth } from "@/contexts/use-auth";
import {
  useListRewardSchemes,
  useListRewardProgress,
  useDisburseReward,
  useCreateRewardScheme,
  useListProducts,
  getListRewardSchemesQueryKey,
  RewardSchemeInputRewardType,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Gift, CheckCircle, Award, Plus, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

const REWARD_TYPE_LABELS: Record<string, string> = {
  free_gift: "Free Gift",
  cash_discount: "Cash Discount",
  percentage_cashback: "Percentage Cashback",
};

export default function Rewards() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole(["admin"]);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [showAdd, setShowAdd] = useState(false);

  const { data: schemes, isLoading: schemesLoading } = useListRewardSchemes();
  const { data: progress, isLoading: progressLoading } = useListRewardProgress({});
  const { data: products } = useListProducts({});
  const disburse = useDisburseReward();
  const createScheme = useCreateRewardScheme();

  const form = useForm({
    defaultValues: {
      schemeName: "",
      productId: "",
      targetLiters: "",
      rewardType: RewardSchemeInputRewardType.free_gift as string,
      rewardValue: "",
      startDate: "",
      endDate: "",
    },
  });

  const openAdd = () => {
    form.reset({
      schemeName: "",
      productId: "",
      targetLiters: "",
      rewardType: RewardSchemeInputRewardType.free_gift,
      rewardValue: "",
      startDate: "",
      endDate: "",
    });
    setShowAdd(true);
  };

  const onSubmit = form.handleSubmit((data) => {
    const payload = {
      schemeName: data.schemeName.trim() || undefined,
      productId: Number(data.productId),
      targetLiters: Number(data.targetLiters),
      rewardType: data.rewardType as RewardSchemeInputRewardType,
      rewardValue: data.rewardValue.trim(),
      startDate: data.startDate,
      endDate: data.endDate,
    };

    createScheme.mutate(
      { data: payload },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListRewardSchemesQueryKey() });
          toast({
            title: "Scheme created",
            description: `${payload.schemeName || "Reward scheme"} added successfully.`,
          });
          setShowAdd(false);
        },
        onError: async (err: any) => {
          let msg = err?.message ?? "Failed to create scheme";
          try {
            const j = await err?.response?.json?.();
            if (j?.error) msg = String(j.error).slice(0, 300);
          } catch {}
          toast({ title: "Create failed", description: msg, variant: "destructive" });
        },
      }
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Volume Rewards</h1>
          <p className="text-muted-foreground mt-2">Manage customer reward schemes and performance.</p>
        </div>
        {isAdmin && (
          <Button onClick={openAdd} data-testid="button-open-add-scheme">
            <Plus className="w-4 h-4 mr-2" /> New Scheme
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Reward Schemes</CardTitle>
          <CardDescription>Active volume-based reward schemes.</CardDescription>
        </CardHeader>
        <CardContent>
          {schemesLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : schemes?.length === 0 ? (
            <p className="text-sm text-muted-foreground">No reward schemes yet.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {schemes?.map((s) => (
                <Card key={s.id} data-testid={`card-scheme-${s.id}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base">
                        {s.schemeName || s.productName || `Scheme #${s.id}`}
                      </CardTitle>
                      <Badge variant={s.isActive ? "default" : "secondary"}>
                        {s.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    {s.schemeName && s.productName && (
                      <CardDescription>{s.productName}</CardDescription>
                    )}
                  </CardHeader>
                  <CardContent className="text-sm space-y-1">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Target</span>
                      <span className="font-medium">{s.targetLiters} L</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Reward</span>
                      <span className="font-medium">
                        {REWARD_TYPE_LABELS[s.rewardType] || s.rewardType} ({s.rewardValue})
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Period</span>
                      <span className="font-medium">
                        {format(new Date(s.startDate), "dd MMM yy")} – {format(new Date(s.endDate), "dd MMM yy")}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Customer Reward Progress</CardTitle>
          <CardDescription>Track volume targets and disburse rewards.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Scheme / Product</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead>Status</TableHead>
                {isAdmin && <TableHead className="text-right">Action</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {progressLoading ? (
                <TableRow><TableCell colSpan={5} className="text-center">Loading...</TableCell></TableRow>
              ) : progress?.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No active progress.</TableCell></TableRow>
              ) : (
                progress?.map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.customerName}</TableCell>
                    <TableCell>{p.productName}</TableCell>
                    <TableCell className="w-[300px]">
                      <div className="flex justify-between text-xs mb-1">
                        <span>{p.litersAchieved} L</span>
                        <span>{p.targetLiters} L</span>
                      </div>
                      <Progress value={p.progressPct || 0} className={p.isRewardAchieved ? "[&>div]:bg-green-500" : ""} />
                    </TableCell>
                    <TableCell>
                      {p.isDisbursed ? (
                        <Badge variant="secondary">Disbursed</Badge>
                      ) : p.isRewardAchieved ? (
                        <Badge className="bg-green-500 text-white animate-pulse"><Award className="w-3 h-3 mr-1"/> Achieved</Badge>
                      ) : (
                        <Badge variant="outline">In Progress</Badge>
                      )}
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="text-right">
                        {p.isRewardAchieved && !p.isDisbursed && (
                          <Button size="sm" onClick={() => disburse.mutate({ id: p.id })}>
                            <Gift className="w-4 h-4 mr-1"/> Settle
                          </Button>
                        )}
                      </TableCell>
                    )}
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
              <Gift className="w-5 h-5 text-primary" />
              New Reward Scheme
            </DialogTitle>
            <DialogDescription>
              Create a volume-based reward scheme for a product.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={onSubmit} className="space-y-3">
              <FormField
                control={form.control}
                name="schemeName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Scheme Name</FormLabel>
                    <FormControl>
                      <Input data-testid="input-scheme-name" placeholder="e.g. Diwali Volume Bonus" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="productId"
                rules={{ required: "Product is required" }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Product *</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger data-testid="select-scheme-product">
                          <SelectValue placeholder="Select product" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {products?.map((prod) => (
                          <SelectItem key={prod.id} value={String(prod.id)}>
                            {prod.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="targetLiters"
                  rules={{ required: "Target is required" }}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Target (Liters) *</FormLabel>
                      <FormControl>
                        <Input data-testid="input-scheme-target" type="number" inputMode="numeric" placeholder="0" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="rewardType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Reward Type *</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger data-testid="select-scheme-reward-type">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="free_gift">Free Gift</SelectItem>
                          <SelectItem value="cash_discount">Cash Discount</SelectItem>
                          <SelectItem value="percentage_cashback">Percentage Cashback</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="rewardValue"
                rules={{ required: "Reward value is required" }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reward Value *</FormLabel>
                    <FormControl>
                      <Input data-testid="input-scheme-reward-value" placeholder="e.g. 500 or 5%" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="startDate"
                  rules={{ required: "Start date is required" }}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Start Date *</FormLabel>
                      <FormControl>
                        <Input data-testid="input-scheme-start-date" type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="endDate"
                  rules={{ required: "End date is required" }}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>End Date *</FormLabel>
                      <FormControl>
                        <Input data-testid="input-scheme-end-date" type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <DialogFooter className="pt-2">
                <Button type="button" variant="outline" onClick={() => setShowAdd(false)} disabled={createScheme.isPending}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createScheme.isPending} data-testid="button-submit-add-scheme">
                  {createScheme.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                  Create Scheme
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
