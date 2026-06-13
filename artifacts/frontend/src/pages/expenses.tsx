import { useState, useMemo } from "react";
import {
  useListExpenses,
  useCreateExpense,
  useDeleteExpense,
  useListExpenseCategories,
  useCreateExpenseCategory,
  useDeleteExpenseCategory,
  getListExpensesQueryKey,
  getListExpenseCategoriesQueryKey,
  type ExpenseInput,
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Loader2, Trash2, Receipt, IndianRupee, Tag, FolderPlus } from "lucide-react";

const formatRs = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);

const todayISO = () => new Date().toISOString().slice(0, 10);
const firstOfMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};

const MODE_LABEL: Record<string, string> = { cash: "Cash", upi: "UPI", bank: "Bank" };
const MODE_TONE: Record<string, string> = {
  cash: "bg-amber-500/10 text-amber-700 border-amber-200",
  upi: "bg-blue-500/10 text-blue-700 border-blue-200",
  bank: "bg-emerald-500/10 text-emerald-700 border-emerald-200",
};

export default function ExpensesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [from, setFrom] = useState<string>(firstOfMonth());
  const [to, setTo] = useState<string>(todayISO());
  const [categoryId, setCategoryId] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [catOpen, setCatOpen] = useState(false);

  const params = {
    from,
    to,
    ...(categoryId !== "all" ? { categoryId: Number(categoryId) } : {}),
  };
  const { data: list, isLoading } = useListExpenses(params);
  const { data: categories } = useListExpenseCategories();
  const activeCats = useMemo(() => (categories ?? []).filter((c) => c.isActive), [categories]);

  const del = useDeleteExpense();

  const handleDelete = (id: number) => {
    if (!confirm("Delete this expense?")) return;
    del.mutate({ id }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListExpensesQueryKey(params) });
        toast({ title: "Expense deleted" });
      },
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Expenses</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Track all daily expenses by category. Rent, bijli, transport, salary, misc — sab ek jagah.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setCatOpen(true)} data-testid="button-manage-categories">
            <FolderPlus className="w-4 h-4 mr-2" /> Categories
          </Button>
          <Button onClick={() => setOpen(true)} data-testid="button-new-expense">
            <Plus className="w-4 h-4 mr-2" /> Add Expense
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-3 flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs">From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" data-testid="filter-from" />
          </div>
          <div>
            <Label className="text-xs">To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" data-testid="filter-to" />
          </div>
          <div>
            <Label className="text-xs">Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {activeCats.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="ml-auto text-right">
            <div className="text-xs text-muted-foreground">Total in range</div>
            <div className="text-2xl font-bold font-mono">{formatRs(list?.total ?? 0)}</div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Receipt className="w-4 h-4" /> Expense Entries</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-12 text-center text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
            ) : (list?.items ?? []).length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">No expenses in this range.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Paid To</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(list?.items ?? []).map((e) => (
                    <TableRow key={e.id} data-testid={`row-expense-${e.id}`}>
                      <TableCell className="text-xs">{e.date}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">{e.categoryName}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">{e.paidTo || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={MODE_TONE[e.paymentMode]}>{MODE_LABEL[e.paymentMode]}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{e.notes || "—"}</TableCell>
                      <TableCell className="text-right font-mono font-medium">{formatRs(e.amount)}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="ghost" onClick={() => handleDelete(e.id)} data-testid={`button-delete-expense-${e.id}`}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Tag className="w-4 h-4" /> By Category</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(list?.byCategory ?? []).length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-6">No data.</div>
            ) : (list?.byCategory ?? []).map((row) => {
              const pct = (list?.total ?? 0) > 0 ? (row.total / (list?.total ?? 1)) * 100 : 0;
              return (
                <div key={`${row.categoryId}-${row.categoryName}`} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">{row.categoryName}</span>
                    <span className="font-mono">{formatRs(row.total)}</span>
                  </div>
                  <div className="h-2 bg-muted rounded">
                    <div className="h-full bg-primary rounded" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <ExpenseDialog open={open} onOpenChange={setOpen} categories={activeCats} params={params} />
      <CategoriesDialog open={catOpen} onOpenChange={setCatOpen} categories={categories ?? []} />
    </div>
  );
}

function ExpenseDialog({ open, onOpenChange, categories, params }: { open: boolean; onOpenChange: (b: boolean) => void; categories: { id: number; name: string }[]; params: any }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateExpense();
  const [form, setForm] = useState<ExpenseInput>({
    date: todayISO(),
    categoryId: 0,
    amount: 0,
    paymentMode: "cash",
    paidTo: "",
    notes: "",
  });

  const reset = () => setForm({ date: todayISO(), categoryId: 0, amount: 0, paymentMode: "cash", paidTo: "", notes: "" });

  const handleSave = () => {
    if (!form.categoryId) {
      toast({ title: "Select category", variant: "destructive" });
      return;
    }
    if (!form.amount || form.amount <= 0) {
      toast({ title: "Enter amount", variant: "destructive" });
      return;
    }
    create.mutate(
      { data: { ...form, paidTo: form.paidTo || undefined, notes: form.notes || undefined } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListExpensesQueryKey(params) });
          toast({ title: "Expense recorded" });
          reset();
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Expense</DialogTitle>
          <DialogDescription>Record a new expense entry.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Date *</Label>
              <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} data-testid="input-expense-date" />
            </div>
            <div>
              <Label>Amount (₹) *</Label>
              <Input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} data-testid="input-expense-amount" />
            </div>
          </div>
          <div>
            <Label>Category *</Label>
            <Select value={form.categoryId ? String(form.categoryId) : ""} onValueChange={(v) => setForm({ ...form, categoryId: Number(v) })}>
              <SelectTrigger data-testid="select-expense-category"><SelectValue placeholder="Choose category" /></SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Payment Mode *</Label>
              <Select value={form.paymentMode} onValueChange={(v) => setForm({ ...form, paymentMode: v as any })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="upi">UPI</SelectItem>
                  <SelectItem value="bank">Bank</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Paid To</Label>
              <Input value={form.paidTo ?? ""} onChange={(e) => setForm({ ...form, paidTo: e.target.value })} placeholder="vendor / person" />
            </div>
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea rows={2} value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={create.isPending} data-testid="button-save-expense">
            {create.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CategoriesDialog({ open, onOpenChange, categories }: { open: boolean; onOpenChange: (b: boolean) => void; categories: { id: number; name: string; isActive: boolean }[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateExpenseCategory();
  const del = useDeleteExpenseCategory();
  const [name, setName] = useState("");

  const handleAdd = () => {
    if (!name.trim()) return;
    create.mutate({ data: { name: name.trim() } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListExpenseCategoriesQueryKey() });
        setName("");
        toast({ title: "Category added" });
      },
      onError: (e: any) => toast({ title: "Failed", description: e?.message, variant: "destructive" }),
    });
  };

  const handleDel = (id: number) => {
    if (!confirm("Deactivate this category?")) return;
    del.mutate({ id }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListExpenseCategoriesQueryKey() });
        toast({ title: "Deactivated" });
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Expense Categories</DialogTitle>
          <DialogDescription>Manage expense categories.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input placeholder="New category name" value={name} onChange={(e) => setName(e.target.value)} data-testid="input-new-category" />
          <Button onClick={handleAdd} disabled={create.isPending} data-testid="button-add-category">
            <Plus className="w-4 h-4" />
          </Button>
        </div>
        <div className="max-h-[300px] overflow-auto border rounded">
          <Table>
            <TableBody>
              {categories.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>{c.name}</TableCell>
                  <TableCell>
                    {!c.isActive && <Badge variant="outline" className="bg-muted text-muted-foreground">Inactive</Badge>}
                  </TableCell>
                  <TableCell className="text-right">
                    {c.isActive && (
                      <Button size="sm" variant="ghost" onClick={() => handleDel(c.id)}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
