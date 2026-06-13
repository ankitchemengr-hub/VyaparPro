import React, { useMemo, useState } from "react";
import {
  useGetSubscriptionDashboard,
  useGetSubscriptionCharts,
  useGetSubscriptionAlerts,
  useListSubscriptions,
  useCreateSubscription,
  useRenewSubscription,
  useChangeSubscriptionPlan,
  useSuspendSubscription,
  useActivateSubscription,
  useUpdateSubscription,
  useDeleteSubscription,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line,
} from "recharts";
import {
  Users, CheckCircle2, XCircle, Clock, TrendingUp, DollarSign, Bell, Plus,
  RefreshCw, ArrowUpDown, Ban, Play, Download, FileSpreadsheet, FileText, Search,
  Pencil, Trash2, AlertTriangle,
} from "lucide-react";

const PLANS = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "half_yearly", label: "Half-Yearly" },
  { value: "yearly", label: "Yearly" },
];

const planLabel = (p: string) => PLANS.find((x) => x.value === p)?.label ?? p;

const fmt = (n: number | null | undefined) =>
  `₹${Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type ExportRow = (string | number | null | undefined)[];

function sanitizeCell(c: string | number | null | undefined): string {
  let s = String(c ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return s;
}

async function exportExcel(baseName: string, rows: ExportRow[]) {
  const XLSX = await import("xlsx");
  const data = rows.map((r) => r.map(sanitizeCell));
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Subscriptions");
  XLSX.writeFile(wb, `${baseName}.xlsx`);
}

async function exportPDF(baseName: string, title: string, rows: ExportRow[]) {
  if (rows.length === 0) return;
  const jsPDF = (await import("jspdf")).default;
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const head = [rows[0].map((c) => String(c ?? ""))];
  const body = rows.slice(1).map((r) => r.map((c) => String(c ?? "")));
  doc.setFontSize(14);
  doc.text(title, 40, 30);
  autoTable(doc, {
    head, body,
    startY: 56,
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [120, 53, 15], textColor: 255 },
    alternateRowStyles: { fillColor: [250, 245, 235] },
    margin: { left: 30, right: 30 },
  });
  doc.save(`${baseName}.pdf`);
}

function exportCSV(baseName: string, rows: ExportRow[]) {
  const csv = rows
    .map((r) => r.map((c) => {
      const s = sanitizeCell(c);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${baseName}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function ExportMenu({ rows }: { rows: ExportRow[] }) {
  const baseName = `subscriptions-${new Date().toISOString().slice(0, 10)}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={rows.length <= 1}>
          <Download className="w-4 h-4 mr-1.5" /> Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => exportExcel(baseName, rows)}>
          <FileSpreadsheet className="w-4 h-4 mr-2" /> Excel (.xlsx)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => exportPDF(baseName, "Subscriptions Report", rows)}>
          <FileText className="w-4 h-4 mr-2" /> PDF (.pdf)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => exportCSV(baseName, rows)}>
          <FileText className="w-4 h-4 mr-2" /> CSV (.csv)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Widget({ icon: Icon, label, value, accent }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; value: string | number; accent?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`w-10 h-10 rounded-md flex items-center justify-center ${accent ?? "bg-primary/10 text-primary"}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-xl font-bold leading-tight">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function expiryColor(days: number, status: string) {
  if (status === "suspended") return "text-muted-foreground";
  if (status === "expired" || days < 0) return "text-red-600";
  if (days <= 30) return "text-orange-500";
  return "text-green-600";
}

function statusBadge(status: string) {
  if (status === "active") return <Badge className="bg-green-600 hover:bg-green-600">Active</Badge>;
  if (status === "expired") return <Badge variant="destructive">Expired</Badge>;
  return <Badge variant="secondary">Suspended</Badge>;
}

function paymentBadge(status: string) {
  if (status === "paid") return <Badge className="bg-green-600 hover:bg-green-600">Paid</Badge>;
  if (status === "overdue") return <Badge variant="destructive">Overdue</Badge>;
  return <Badge variant="secondary">Pending</Badge>;
}

const emptyForm = {
  companyName: "", ownerName: "", mobile: "", email: "",
  planName: "monthly", subscriptionAmount: "", subscriptionStartDate: new Date().toISOString().slice(0, 10),
  paymentStatus: "pending",
  adminUsername: "", adminPassword: "",
};

export default function Subscriptions() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const dashboard = useGetSubscriptionDashboard();
  const charts = useGetSubscriptionCharts();
  const alerts = useGetSubscriptionAlerts();
  const list = useListSubscriptions({
    search: search || undefined,
    status: statusFilter === "all" ? undefined : statusFilter,
  });

  const invalidate = () => {
    queryClient.invalidateQueries();
  };
  const onErr = (e: unknown) =>
    toast({ title: "Error", description: e instanceof Error ? e.message : "Operation failed", variant: "destructive" });

  const createMut = useCreateSubscription({ mutation: { onSuccess: () => { invalidate(); toast({ title: "Subscription created" }); }, onError: onErr } });
  const renewMut = useRenewSubscription({ mutation: { onSuccess: () => { invalidate(); toast({ title: "Subscription renewed" }); }, onError: onErr } });
  const planMut = useChangeSubscriptionPlan({ mutation: { onSuccess: () => { invalidate(); toast({ title: "Plan updated" }); }, onError: onErr } });
  const suspendMut = useSuspendSubscription({ mutation: { onSuccess: () => { invalidate(); toast({ title: "Subscription suspended" }); }, onError: onErr } });
  const activateMut = useActivateSubscription({ mutation: { onSuccess: () => { invalidate(); toast({ title: "Subscription activated" }); }, onError: onErr } });
  const editMut = useUpdateSubscription({ mutation: { onSuccess: () => { invalidate(); toast({ title: "Subscription updated" }); }, onError: onErr } });
  const deleteMut = useDeleteSubscription({ mutation: { onSuccess: (r) => { invalidate(); toast({ title: "Subscription deleted", description: `${r.companyName} and all its data were removed.` }); }, onError: onErr } });

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const [planOpen, setPlanOpen] = useState(false);
  const [planTarget, setPlanTarget] = useState<{ id: number; planName: string; amount: string } | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<{
    id: number; companyName: string; ownerName: string; mobile: string; email: string;
    planName: string; subscriptionAmount: string; subscriptionStartDate: string;
    subscriptionEndDate: string; paymentStatus: string;
  } | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<{ id: number; companyName: string } | null>(null);

  const rows = list.data ?? [];
  const d = dashboard.data;
  const c = charts.data;

  const exportRows: ExportRow[] = useMemo(() => {
    const header = ["Company", "Owner", "Mobile", "Plan", "Start", "End", "Amount", "Payment", "Status", "Days Left"];
    return [header, ...rows.map((r) => [
      r.companyName, r.ownerName ?? "", r.mobile ?? "", planLabel(r.planName),
      r.subscriptionStartDate.slice(0, 10), r.subscriptionEndDate.slice(0, 10),
      r.subscriptionAmount, r.paymentStatus, r.subscriptionStatus, r.daysRemaining,
    ])];
  }, [rows]);

  const submitCreate = () => {
    const amount = Number(form.subscriptionAmount);
    if (!form.companyName.trim() || Number.isNaN(amount) || amount <= 0) {
      toast({ title: "Validation", description: "Company name and a valid amount are required.", variant: "destructive" });
      return;
    }
    createMut.mutate({
      data: {
        companyName: form.companyName.trim(),
        ownerName: form.ownerName || null,
        mobile: form.mobile || null,
        email: form.email || null,
        planName: form.planName as "monthly" | "quarterly" | "half_yearly" | "yearly",
        subscriptionAmount: amount,
        subscriptionStartDate: new Date(form.subscriptionStartDate).toISOString(),
        paymentStatus: form.paymentStatus as "paid" | "pending" | "overdue",
        adminUsername: form.adminUsername.trim() || null,
        adminPassword: form.adminPassword.trim() || null,
      },
    }, { onSuccess: () => { setCreateOpen(false); setForm(emptyForm); } });
  };

  const submitPlan = () => {
    if (!planTarget) return;
    const amount = Number(planTarget.amount);
    if (Number.isNaN(amount) || amount <= 0) {
      toast({ title: "Validation", description: "Valid amount required.", variant: "destructive" });
      return;
    }
    planMut.mutate({
      id: planTarget.id,
      data: { planName: planTarget.planName as "monthly" | "quarterly" | "half_yearly" | "yearly", subscriptionAmount: amount },
    }, { onSuccess: () => { setPlanOpen(false); setPlanTarget(null); } });
  };

  const openEdit = (r: (typeof rows)[number]) => {
    setEditTarget({
      id: r.id,
      companyName: r.companyName,
      ownerName: r.ownerName ?? "",
      mobile: r.mobile ?? "",
      email: r.email ?? "",
      planName: r.planName,
      subscriptionAmount: String(r.subscriptionAmount),
      subscriptionStartDate: r.subscriptionStartDate.slice(0, 10),
      subscriptionEndDate: r.subscriptionEndDate.slice(0, 10),
      paymentStatus: r.paymentStatus,
    });
    setEditOpen(true);
  };

  const submitEdit = () => {
    if (!editTarget) return;
    const amount = Number(editTarget.subscriptionAmount);
    if (!editTarget.companyName.trim() || Number.isNaN(amount) || amount <= 0) {
      toast({ title: "Validation", description: "Company name and a valid amount are required.", variant: "destructive" });
      return;
    }
    if (new Date(editTarget.subscriptionEndDate) <= new Date(editTarget.subscriptionStartDate)) {
      toast({ title: "Validation", description: "End date must be after the start date.", variant: "destructive" });
      return;
    }
    editMut.mutate({
      id: editTarget.id,
      data: {
        companyName: editTarget.companyName.trim(),
        ownerName: editTarget.ownerName || null,
        mobile: editTarget.mobile || null,
        email: editTarget.email || null,
        planName: editTarget.planName as "monthly" | "quarterly" | "half_yearly" | "yearly",
        subscriptionAmount: amount,
        subscriptionStartDate: new Date(editTarget.subscriptionStartDate).toISOString(),
        subscriptionEndDate: new Date(editTarget.subscriptionEndDate).toISOString(),
        paymentStatus: editTarget.paymentStatus as "paid" | "pending" | "overdue",
      },
    }, { onSuccess: () => { setEditOpen(false); setEditTarget(null); } });
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    deleteMut.mutate({ id: deleteTarget.id }, { onSuccess: () => setDeleteTarget(null) });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Subscription Management</h1>
          <p className="text-sm text-muted-foreground mt-1">Tenant companies, plans, renewals and revenue.</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-1.5" /> New Subscription</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Subscription</DialogTitle>
              <DialogDescription>Register a tenant company and start its subscription plan.</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label>Company Name</Label>
                <Input value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Owner Name</Label>
                <Input value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Mobile</Label>
                <Input value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Email</Label>
                <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Plan</Label>
                <Select value={form.planName} onValueChange={(v) => setForm({ ...form, planName: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PLANS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Amount (₹)</Label>
                <Input type="number" value={form.subscriptionAmount} onChange={(e) => setForm({ ...form, subscriptionAmount: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Start Date</Label>
                <Input type="date" value={form.subscriptionStartDate} onChange={(e) => setForm({ ...form, subscriptionStartDate: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Payment Status</Label>
                <Select value={form.paymentStatus} onValueChange={(v) => setForm({ ...form, paymentStatus: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="overdue">Overdue</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 col-span-2 border-t pt-3 mt-1">
                <Label className="text-sm font-semibold">Company Admin Login</Label>
                <p className="text-xs text-muted-foreground">Set the username and password this company will use to log in. Leave blank to skip.</p>
              </div>
              <div className="space-y-1.5">
                <Label>Admin Username</Label>
                <Input value={form.adminUsername} autoComplete="off" onChange={(e) => setForm({ ...form, adminUsername: e.target.value })} placeholder="e.g. sunrise_admin" />
              </div>
              <div className="space-y-1.5">
                <Label>Admin Password</Label>
                <Input type="text" value={form.adminPassword} autoComplete="off" onChange={(e) => setForm({ ...form, adminPassword: e.target.value })} placeholder="Set a password" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button onClick={submitCreate} disabled={createMut.isPending}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Widgets */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Widget icon={CheckCircle2} label="Active" value={d?.totalActive ?? 0} accent="bg-green-600/10 text-green-600" />
        <Widget icon={XCircle} label="Expired" value={d?.totalExpired ?? 0} accent="bg-red-600/10 text-red-600" />
        <Widget icon={Ban} label="Suspended" value={d?.totalSuspended ?? 0} accent="bg-muted text-muted-foreground" />
        <Widget icon={Users} label="Companies" value={d?.totalCompanies ?? 0} />
        <Widget icon={Clock} label="Expiring ≤7 days" value={d?.expiringIn7Days ?? 0} accent="bg-orange-500/10 text-orange-500" />
        <Widget icon={Clock} label="Expiring ≤30 days" value={d?.expiringIn30Days ?? 0} accent="bg-orange-500/10 text-orange-500" />
        <Widget icon={DollarSign} label="MRR" value={fmt(d?.mrr)} accent="bg-primary/10 text-primary" />
        <Widget icon={TrendingUp} label="ARR" value={fmt(d?.arr)} accent="bg-primary/10 text-primary" />
      </div>

      <Tabs defaultValue="subscriptions">
        <TabsList>
          <TabsTrigger value="subscriptions">Subscriptions</TabsTrigger>
          <TabsTrigger value="charts">Analytics</TabsTrigger>
          <TabsTrigger value="alerts">
            Alerts {alerts.data && alerts.data.length > 0 ? `(${alerts.data.length})` : ""}
          </TabsTrigger>
        </TabsList>

        {/* SUBSCRIPTIONS TABLE */}
        <TabsContent value="subscriptions" className="space-y-4">
          <div className="flex items-end gap-3 flex-wrap">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Search</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Company, mobile, email…" className="pl-8 w-[240px]" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                  <SelectItem value="suspended">Suspended</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="ml-auto"><ExportMenu rows={exportRows} /></div>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Company</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>End Date</TableHead>
                    <TableHead className="text-right">Days Left</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 && (
                    <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No subscriptions found.</TableCell></TableRow>
                  )}
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <div className="font-medium">{r.companyName}</div>
                        <div className="text-xs text-muted-foreground">{r.mobile ?? r.email ?? ""}</div>
                      </TableCell>
                      <TableCell>{planLabel(r.planName)}</TableCell>
                      <TableCell>{r.subscriptionEndDate.slice(0, 10)}</TableCell>
                      <TableCell className={`text-right font-semibold ${expiryColor(r.daysRemaining, r.subscriptionStatus)}`}>
                        {r.subscriptionStatus === "suspended" ? "—" : `${r.daysRemaining}d`}
                      </TableCell>
                      <TableCell className="text-right">{fmt(r.subscriptionAmount)}</TableCell>
                      <TableCell>{paymentBadge(r.paymentStatus)}</TableCell>
                      <TableCell>{statusBadge(r.subscriptionStatus)}</TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm"><ArrowUpDown className="w-4 h-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEdit(r)}>
                              <Pencil className="w-4 h-4 mr-2" /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => renewMut.mutate({ id: r.id })}>
                              <RefreshCw className="w-4 h-4 mr-2" /> Renew
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => { setPlanTarget({ id: r.id, planName: r.planName, amount: String(r.subscriptionAmount) }); setPlanOpen(true); }}>
                              <ArrowUpDown className="w-4 h-4 mr-2" /> Change Plan
                            </DropdownMenuItem>
                            {r.subscriptionStatus === "suspended" ? (
                              <DropdownMenuItem onClick={() => activateMut.mutate({ id: r.id })}>
                                <Play className="w-4 h-4 mr-2" /> Activate
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onClick={() => suspendMut.mutate({ id: r.id })}>
                                <Ban className="w-4 h-4 mr-2" /> Suspend
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-red-600 focus:text-red-600"
                              onClick={() => setDeleteTarget({ id: r.id, companyName: r.companyName })}
                            >
                              <Trash2 className="w-4 h-4 mr-2" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* CHARTS */}
        <TabsContent value="charts" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Monthly Revenue</CardTitle></CardHeader>
              <CardContent className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={c?.monthlyRevenue ?? []}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="month" fontSize={11} />
                    <YAxis fontSize={11} />
                    <Tooltip formatter={(v) => fmt(Number(v))} />
                    <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Subscription Growth</CardTitle></CardHeader>
              <CardContent className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={c?.subscriptionGrowth ?? []}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="month" fontSize={11} />
                    <YAxis fontSize={11} allowDecimals={false} />
                    <Tooltip />
                    <Line type="monotone" dataKey="total" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader><CardTitle className="text-base">Expiry Trend</CardTitle></CardHeader>
              <CardContent className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={c?.expiryTrend ?? []}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="month" fontSize={11} />
                    <YAxis fontSize={11} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="expiring" fill="#f97316" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ALERTS */}
        <TabsContent value="alerts">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Company</TableHead>
                    <TableHead>Alert</TableHead>
                    <TableHead className="text-right">Days Left</TableHead>
                    <TableHead>Raised</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(alerts.data ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No alerts.</TableCell></TableRow>
                  )}
                  {(alerts.data ?? []).map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{a.companyName}</TableCell>
                      <TableCell className="flex items-center gap-2">
                        <Bell className="w-4 h-4 text-orange-500" /> {a.message}
                      </TableCell>
                      <TableCell className={`text-right font-semibold ${expiryColor(a.daysRemaining, "active")}`}>{a.daysRemaining}d</TableCell>
                      <TableCell>{a.createdAt.slice(0, 10)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* CHANGE PLAN DIALOG */}
      <Dialog open={planOpen} onOpenChange={setPlanOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Plan</DialogTitle>
            <DialogDescription>Upgrade or downgrade the plan and adjust the amount.</DialogDescription>
          </DialogHeader>
          {planTarget && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Plan</Label>
                <Select value={planTarget.planName} onValueChange={(v) => setPlanTarget({ ...planTarget, planName: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PLANS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Amount (₹)</Label>
                <Input type="number" value={planTarget.amount} onChange={(e) => setPlanTarget({ ...planTarget, amount: e.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPlanOpen(false)}>Cancel</Button>
            <Button onClick={submitPlan} disabled={planMut.isPending}>Update Plan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* EDIT SUBSCRIPTION DIALOG */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Subscription</DialogTitle>
            <DialogDescription>Update the tenant company and its subscription details.</DialogDescription>
          </DialogHeader>
          {editTarget && (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label>Company Name</Label>
                <Input value={editTarget.companyName} onChange={(e) => setEditTarget({ ...editTarget, companyName: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Owner Name</Label>
                <Input value={editTarget.ownerName} onChange={(e) => setEditTarget({ ...editTarget, ownerName: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Mobile</Label>
                <Input value={editTarget.mobile} onChange={(e) => setEditTarget({ ...editTarget, mobile: e.target.value })} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Email</Label>
                <Input value={editTarget.email} onChange={(e) => setEditTarget({ ...editTarget, email: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Plan</Label>
                <Select value={editTarget.planName} onValueChange={(v) => setEditTarget({ ...editTarget, planName: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PLANS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Amount (₹)</Label>
                <Input type="number" value={editTarget.subscriptionAmount} onChange={(e) => setEditTarget({ ...editTarget, subscriptionAmount: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Start Date</Label>
                <Input type="date" value={editTarget.subscriptionStartDate} onChange={(e) => setEditTarget({ ...editTarget, subscriptionStartDate: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>End Date</Label>
                <Input type="date" value={editTarget.subscriptionEndDate} onChange={(e) => setEditTarget({ ...editTarget, subscriptionEndDate: e.target.value })} />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>Payment Status</Label>
                <Select value={editTarget.paymentStatus} onValueChange={(v) => setEditTarget({ ...editTarget, paymentStatus: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="overdue">Overdue</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={submitEdit} disabled={editMut.isPending}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DELETE CONFIRM */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-5 h-5" /> Delete subscription?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes <span className="font-semibold">{deleteTarget?.companyName}</span> along with its
              subscription and <span className="font-semibold">all of its data</span> — logins, products, parties,
              invoices, payments and history. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleteMut.isPending}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {deleteMut.isPending ? "Deleting…" : "Delete permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
