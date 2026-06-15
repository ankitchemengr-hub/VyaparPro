import { useState, useMemo } from "react";
import {
  useListWorkers,
  useCreateWorker,
  useUpdateWorker,
  useDeleteWorker,
  useListWorkerAttendance,
  useUpsertWorkerAttendance,
  useGetWorkerLedger,
  useCreateWorkerPayment,
  getListWorkersQueryKey,
  getListWorkerAttendanceQueryKey,
  getGetWorkerLedgerQueryKey,
  type Worker,
  type WorkerInput,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Loader2, HardHat, IndianRupee, BookOpen, Phone, CalendarDays, Wallet } from "lucide-react";

const formatRs = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);

const todayISO = () => new Date().toISOString().slice(0, 10);

type Status = "present" | "absent" | "half_day";
const STATUS_LABEL: Record<Status, string> = { present: "Present", absent: "Absent", half_day: "Half Day" };
const STATUS_TONE: Record<Status, string> = {
  present: "bg-emerald-500/10 text-emerald-700 border-emerald-200",
  absent: "bg-rose-500/10 text-rose-700 border-rose-200",
  half_day: "bg-amber-500/10 text-amber-700 border-amber-200",
};

export default function WorkersPage() {
  const [tab, setTab] = useState<"workers" | "attendance">("workers");
  const [editing, setEditing] = useState<Worker | null>(null);
  const [open, setOpen] = useState(false);
  const [ledgerWorker, setLedgerWorker] = useState<Worker | null>(null);

  const { data: workers, isLoading } = useListWorkers({ includeInactive: true });
  const activeWorkers = useMemo(() => (workers ?? []).filter((w) => w.isActive), [workers]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Workers</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Daily workers, attendance aur payments — wages auto-calculate based on daily rate.
          </p>
        </div>
        <Button onClick={() => { setEditing(null); setOpen(true); }} data-testid="button-new-worker">
          <Plus className="w-4 h-4 mr-2" /> Add Worker
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <HardHat className="w-4 h-4" /> Active Workers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeWorkers.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <IndianRupee className="w-4 h-4" /> Daily Wage Outflow (if all present)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatRs(activeWorkers.reduce((s, w) => s + Number(w.dailyWage || 0), 0))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <CalendarDays className="w-4 h-4" /> Today
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{todayISO()}</div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="workers">All Workers</TabsTrigger>
          <TabsTrigger value="attendance">Mark Attendance</TabsTrigger>
        </TabsList>

        <TabsContent value="workers" className="mt-4">
          <Card>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-12 text-center text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
              ) : (workers ?? []).length === 0 ? (
                <div className="p-12 text-center text-muted-foreground">No workers yet. Click "Add Worker" to get started.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Skill</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead className="text-right">Daily Wage</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(workers ?? []).map((w) => (
                      <TableRow key={w.id} data-testid={`row-worker-${w.id}`}>
                        <TableCell className="font-medium">{w.name}</TableCell>
                        <TableCell className="text-muted-foreground">{w.skill || "—"}</TableCell>
                        <TableCell className="text-muted-foreground">{w.phone || "—"}</TableCell>
                        <TableCell className="text-right font-mono">{formatRs(Number(w.dailyWage))}</TableCell>
                        <TableCell>
                          {w.isActive ? (
                            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-200">Active</Badge>
                          ) : (
                            <Badge variant="outline" className="bg-muted text-muted-foreground">Inactive</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="ghost" onClick={() => setLedgerWorker(w)} data-testid={`button-ledger-${w.id}`}>
                              <BookOpen className="w-4 h-4 mr-1" /> Ledger
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => { setEditing(w); setOpen(true); }} data-testid={`button-edit-worker-${w.id}`}>
                              <Pencil className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="attendance" className="mt-4">
          <AttendanceTab workers={activeWorkers} />
        </TabsContent>
      </Tabs>

      <WorkerDialog open={open} onOpenChange={setOpen} worker={editing} />
      <LedgerDialog worker={ledgerWorker} onClose={() => setLedgerWorker(null)} />
    </div>
  );
}

function WorkerDialog({ open, onOpenChange, worker }: { open: boolean; onOpenChange: (b: boolean) => void; worker: Worker | null }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateWorker();
  const update = useUpdateWorker();
  const del = useDeleteWorker();

  const [form, setForm] = useState<WorkerInput>(() => ({
    name: worker?.name ?? "",
    phone: worker?.phone ?? "",
    skill: worker?.skill ?? "",
    dailyWage: Number(worker?.dailyWage ?? 0),
    joinedAt: worker?.joinedAt ?? todayISO(),
    isActive: worker?.isActive ?? true,
    notes: worker?.notes ?? "",
  }));

  // Reset form when dialog opens with different worker
  const workerKey = worker?.id ?? "new";
  const [seedKey, setSeedKey] = useState<string | number>(workerKey);
  if (seedKey !== workerKey) {
    setSeedKey(workerKey);
    setForm({
      name: worker?.name ?? "",
      phone: worker?.phone ?? "",
      skill: worker?.skill ?? "",
      dailyWage: Number(worker?.dailyWage ?? 0),
      joinedAt: worker?.joinedAt ?? todayISO(),
      isActive: worker?.isActive ?? true,
      notes: worker?.notes ?? "",
    });
  }

  const handleSave = () => {
    if (!form.name.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    const body: WorkerInput = {
      name: form.name.trim(),
      phone: form.phone || undefined,
      skill: form.skill || undefined,
      dailyWage: Number(form.dailyWage),
      joinedAt: form.joinedAt || undefined,
      isActive: form.isActive,
      notes: form.notes || undefined,
    };
    const onDone = () => {
      qc.invalidateQueries({ queryKey: getListWorkersQueryKey() });
      onOpenChange(false);
      toast({ title: worker ? "Worker updated" : "Worker added" });
    };
    if (worker) {
      update.mutate({ id: worker.id, data: body }, { onSuccess: onDone });
    } else {
      create.mutate({ data: body }, { onSuccess: onDone });
    }
  };

  const handleDeactivate = () => {
    if (!worker) return;
    if (!confirm(`Deactivate worker "${worker.name}"?`)) return;
    del.mutate({ id: worker.id }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListWorkersQueryKey() });
        onOpenChange(false);
        toast({ title: "Worker deactivated" });
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{worker ? "Edit Worker" : "Add Worker"}</DialogTitle>
          <DialogDescription>Daily wage worker details — wages auto-calculate on attendance.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div>
            <Label>Name *</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-worker-name" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Phone</Label>
              <Input
                value={form.phone ?? ""}
                onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, "").slice(0, 10) })}
                inputMode="numeric"
                maxLength={10}
                placeholder="9876543210"
              />
            </div>
            <div>
              <Label>Skill / Role</Label>
              <Input placeholder="e.g. Helper, Driver, Loader" value={form.skill ?? ""} onChange={(e) => setForm({ ...form, skill: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Daily Wage (₹) *</Label>
              <Input type="number" min="0" step="1" value={form.dailyWage} onChange={(e) => setForm({ ...form, dailyWage: Number(e.target.value) })} data-testid="input-daily-wage" />
            </div>
            <div>
              <Label>Joined On</Label>
              <Input type="date" value={form.joinedAt ?? ""} onChange={(e) => setForm({ ...form, joinedAt: e.target.value })} />
            </div>
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea rows={2} value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          {worker && worker.isActive && (
            <Button variant="outline" className="text-destructive border-destructive/40 hover:bg-destructive/10 mr-auto" onClick={handleDeactivate} disabled={del.isPending}>
              Deactivate
            </Button>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={create.isPending || update.isPending} data-testid="button-save-worker">
            {(create.isPending || update.isPending) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AttendanceTab({ workers }: { workers: Worker[] }) {
  const [date, setDate] = useState<string>(todayISO());
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: existing, isLoading } = useListWorkerAttendance({ date });
  const upsert = useUpsertWorkerAttendance();

  const existingByWorker = useMemo(() => {
    const m = new Map<number, Status>();
    (existing ?? []).forEach((a) => m.set(a.workerId, a.status as Status));
    return m;
  }, [existing]);

  const mark = (workerId: number, status: Status) => {
    upsert.mutate(
      { data: { workerId, date, status } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListWorkerAttendanceQueryKey({ date }) });
          qc.invalidateQueries({ queryKey: getGetWorkerLedgerQueryKey(workerId) });
        },
        onError: () => toast({ title: "Failed to save attendance", variant: "destructive" }),
      },
    );
  };

  const totalWage = (existing ?? []).reduce((s, a) => s + Number(a.wageAmount), 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="text-base">Attendance for</CardTitle>
          <div className="flex items-center gap-3">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" data-testid="input-attendance-date" />
            <div className="text-sm text-muted-foreground">
              Total wage: <span className="font-bold text-foreground font-mono">{formatRs(totalWage)}</span>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-12 text-center text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
        ) : workers.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">No active workers.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Worker</TableHead>
                <TableHead className="text-right">Daily Wage</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workers.map((w) => {
                const cur = existingByWorker.get(w.id);
                return (
                  <TableRow key={w.id}>
                    <TableCell>
                      <div className="font-medium">{w.name}</div>
                      {w.skill && <div className="text-xs text-muted-foreground">{w.skill}</div>}
                    </TableCell>
                    <TableCell className="text-right font-mono">{formatRs(Number(w.dailyWage))}</TableCell>
                    <TableCell>
                      {cur ? (
                        <Badge variant="outline" className={STATUS_TONE[cur]}>{STATUS_LABEL[cur]}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not marked</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex gap-1">
                        <Button size="sm" variant={cur === "present" ? "default" : "outline"} onClick={() => mark(w.id, "present")} data-testid={`btn-present-${w.id}`}>P</Button>
                        <Button size="sm" variant={cur === "half_day" ? "default" : "outline"} onClick={() => mark(w.id, "half_day")} data-testid={`btn-half-${w.id}`}>½</Button>
                        <Button size="sm" variant={cur === "absent" ? "default" : "outline"} onClick={() => mark(w.id, "absent")} data-testid={`btn-absent-${w.id}`}>A</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function LedgerDialog({ worker, onClose }: { worker: Worker | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const open = !!worker;
  const ledgerKey = getGetWorkerLedgerQueryKey(worker?.id ?? 0);
  const { data: ledger, isLoading } = useGetWorkerLedger(worker?.id ?? 0, { query: { enabled: !!worker, queryKey: ledgerKey } });
  const createPayment = useCreateWorkerPayment();

  const [payAmount, setPayAmount] = useState<number>(0);
  const [payOn, setPayOn] = useState<string>(todayISO());
  const [payMode, setPayMode] = useState<"cash" | "upi" | "bank">("cash");
  const [payNotes, setPayNotes] = useState("");

  const handlePay = () => {
    if (!worker || !payAmount || payAmount <= 0) {
      toast({ title: "Enter amount", variant: "destructive" });
      return;
    }
    createPayment.mutate(
      { data: { workerId: worker.id, amount: payAmount, paidOn: payOn, paymentMode: payMode, notes: payNotes || undefined } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetWorkerLedgerQueryKey(worker.id) });
          setPayAmount(0);
          setPayNotes("");
          toast({ title: "Payment recorded" });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{worker?.name} — Ledger</DialogTitle>
          <DialogDescription>Earnings from attendance vs payments made.</DialogDescription>
        </DialogHeader>

        {isLoading || !ledger ? (
          <div className="p-12 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <div className="border rounded p-3">
                <div className="text-xs text-muted-foreground">Total Earned</div>
                <div className="text-xl font-bold font-mono">{formatRs(ledger.totalEarned)}</div>
              </div>
              <div className="border rounded p-3">
                <div className="text-xs text-muted-foreground">Total Paid</div>
                <div className="text-xl font-bold font-mono">{formatRs(ledger.totalPaid)}</div>
              </div>
              <div className={`border rounded p-3 ${ledger.balance > 0 ? "bg-amber-500/5 border-amber-300" : ""}`}>
                <div className="text-xs text-muted-foreground">Balance (Owe Worker)</div>
                <div className="text-xl font-bold font-mono">{formatRs(ledger.balance)}</div>
              </div>
            </div>

            <div className="max-h-[300px] overflow-auto border rounded">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ledger.entries.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No entries yet.</TableCell></TableRow>
                  ) : ledger.entries.map((e, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs">{e.date}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={e.kind === "attendance" ? "bg-emerald-500/10 text-emerald-700 border-emerald-200" : "bg-blue-500/10 text-blue-700 border-blue-200"}>
                          {e.kind === "attendance" ? (e.status ? STATUS_LABEL[e.status as Status] : "Attendance") : `Paid (${e.status ?? ""})`}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{e.notes || "—"}</TableCell>
                      <TableCell className={`text-right font-mono ${e.amount < 0 ? "text-blue-700" : ""}`}>
                        {e.amount >= 0 ? "+" : ""}{formatRs(e.amount)}
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium">{formatRs(e.balance)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="border-t pt-3">
              <div className="text-sm font-medium mb-2 flex items-center gap-2"><Wallet className="w-4 h-4" /> Record Payment</div>
              <div className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-3">
                  <Label className="text-xs">Amount</Label>
                  <Input type="number" min="0" value={payAmount} onChange={(e) => setPayAmount(Number(e.target.value))} data-testid="input-pay-amount" />
                </div>
                <div className="col-span-3">
                  <Label className="text-xs">Paid On</Label>
                  <Input type="date" value={payOn} onChange={(e) => setPayOn(e.target.value)} />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">Mode</Label>
                  <Select value={payMode} onValueChange={(v) => setPayMode(v as any)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="upi">UPI</SelectItem>
                      <SelectItem value="bank">Bank</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-3">
                  <Label className="text-xs">Notes</Label>
                  <Input value={payNotes} onChange={(e) => setPayNotes(e.target.value)} placeholder="optional" />
                </div>
                <div className="col-span-1">
                  <Button className="w-full" onClick={handlePay} disabled={createPayment.isPending} data-testid="button-record-payment">
                    {createPayment.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Pay"}
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
