import { useState, useMemo } from "react";
import {
  useListExpenses,
  useCreateExpense,
  useDeleteExpense,
  useListExpenseCategories,
  useCreateExpenseCategory,
  useDeleteExpenseCategory,
  useListAccounts,
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { Plus, Loader2, Trash2, Receipt, Tag, FolderPlus, CalendarDays, FileBarChart, Printer, ChevronsUpDown, Check } from "lucide-react";

// Type-to-search picker for Category — a plain <Select> forced scrolling
// through the whole list with no way to filter, which was especially
// unusable on a phone screen once there were more than a handful of them.
function CategoryCombobox({
  categories, value, onChange, placeholder = "Choose category", testId,
}: {
  categories: { id: number; name: string }[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = categories.find((c) => String(c.id) === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          type="button"
          aria-expanded={open}
          className="w-full justify-between font-normal"
          data-testid={testId}
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected ? selected.name : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] max-w-[calc(100vw-2rem)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search category…" />
          <CommandList className="max-h-60">
            <CommandEmpty>No category found.</CommandEmpty>
            <CommandGroup>
              {categories.map((c) => (
                <CommandItem
                  key={c.id}
                  value={c.name}
                  onSelect={() => {
                    onChange(String(c.id));
                    setOpen(false);
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4 shrink-0", value === String(c.id) ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{c.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

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
  const [open, setOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  return (
    <div className="space-y-6 print:hidden">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Expenses</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Track all daily expenses by category. Rent, bijli, transport, salary, misc — sab ek jagah.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => setReportOpen(true)} data-testid="button-expense-report">
            <FileBarChart className="w-4 h-4 mr-2" /> Report
          </Button>
          <Button className="flex-1 sm:flex-none" onClick={() => setOpen(true)} data-testid="button-new-expense">
            <Plus className="w-4 h-4 mr-2" /> Add Expense
          </Button>
        </div>
      </div>

      <ExpenseDialog open={open} onOpenChange={setOpen} />
      <ExpenseReportDialog open={reportOpen} onOpenChange={setReportOpen} />
    </div>
  );
}

function ExpenseDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (b: boolean) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateExpense();
  const [catOpen, setCatOpen] = useState(false);
  const { data: categories } = useListExpenseCategories();
  const activeCats = useMemo(() => (categories ?? []).filter((c) => c.isActive), [categories]);
  const { data: accounts } = useListAccounts();
  const activeAccounts = useMemo(() => (accounts ?? []).filter((a) => a.isActive), [accounts]);
  const [form, setForm] = useState<ExpenseInput>({
    date: todayISO(),
    categoryId: 0,
    amount: 0,
    paymentMode: "cash",
    accountId: 0,
    paidTo: "",
    notes: "",
  });

  const reset = () => setForm({ date: todayISO(), categoryId: 0, amount: 0, paymentMode: "cash", accountId: 0, paidTo: "", notes: "" });

  const handleSave = () => {
    if (!form.categoryId) {
      toast({ title: "Select category", variant: "destructive" });
      return;
    }
    if (!form.accountId) {
      toast({ title: "Select which account this was paid from", variant: "destructive" });
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
          qc.invalidateQueries({ queryKey: getListExpensesQueryKey() });
          toast({ title: "Expense recorded" });
          reset();
          onOpenChange(false);
        },
        onError: async (e: any) => {
          let desc = e?.message ?? "Server error";
          try {
            const body = e?.response ? await e.response.json() : null;
            if (body?.error) desc = String(body.error);
          } catch {}
          toast({ title: "Could not save expense", description: desc, variant: "destructive" });
        },
      },
    );
  };

  return (
    <>
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
            <div className="flex items-center justify-between">
              <Label>Category *</Label>
              <button
                type="button"
                className="text-xs text-primary hover:underline flex items-center gap-1"
                onClick={() => setCatOpen(true)}
                data-testid="button-manage-categories"
              >
                <FolderPlus className="w-3 h-3" /> Manage
              </button>
            </div>
            <CategoryCombobox
              categories={activeCats}
              value={form.categoryId ? String(form.categoryId) : ""}
              onChange={(v) => setForm({ ...form, categoryId: Number(v) })}
              testId="select-expense-category"
            />
          </div>
          <div>
            <Label>Paid From Account *</Label>
            <Select value={form.accountId ? String(form.accountId) : ""} onValueChange={(v) => setForm({ ...form, accountId: Number(v) })}>
              <SelectTrigger data-testid="select-expense-account"><SelectValue placeholder="Choose account" /></SelectTrigger>
              <SelectContent>
                {activeAccounts.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground mt-1">Deducted from this account's balance and shows up in Cash Book.</p>
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
    <CategoriesDialog open={catOpen} onOpenChange={setCatOpen} categories={categories ?? []} />
    </>
  );
}

function ExpenseReportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (b: boolean) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [from, setFrom] = useState<string>(firstOfMonth());
  const [to, setTo] = useState<string>(todayISO());
  const [categoryId, setCategoryId] = useState<string>("all");
  const [groupBy, setGroupBy] = useState<"category" | "date">("category");

  const params = {
    from,
    to,
    ...(categoryId !== "all" ? { categoryId: Number(categoryId) } : {}),
  };
  const { data: list, isLoading } = useListExpenses(params, {
    query: { enabled: open, queryKey: getListExpensesQueryKey(params) },
  });
  const { data: categories } = useListExpenseCategories({
    query: { enabled: open, queryKey: getListExpenseCategoriesQueryKey() },
  });
  const activeCats = useMemo(() => (categories ?? []).filter((c) => c.isActive), [categories]);

  const byDate = useMemo(() => {
    const totals = new Map<string, number>();
    for (const e of list?.items ?? []) {
      totals.set(e.date, (totals.get(e.date) ?? 0) + Number(e.amount));
    }
    return Array.from(totals.entries())
      .map(([date, total]) => ({ date, total }))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [list?.items]);

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[calc(100vw-1.5rem)] sm:w-full max-h-[92dvh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader className="print:hidden">
          <DialogTitle className="flex items-center gap-2"><FileBarChart className="w-5 h-5" /> Expense Report</DialogTitle>
          <DialogDescription>Filter by date range and category, then print if needed.</DialogDescription>
        </DialogHeader>

        {/* Print-only heading — hidden on screen, shown when printing */}
        <div className="hidden print:block mb-2">
          <h1 className="text-xl font-bold">Expense Report</h1>
          <p className="text-sm text-muted-foreground">
            {from} to {to}{categoryId !== "all" ? ` — ${activeCats.find((c) => String(c.id) === categoryId)?.name ?? ""}` : ""}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end print:hidden">
          <div className="space-y-1">
            <Label className="text-xs">From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full sm:w-40" data-testid="filter-from" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full sm:w-40" data-testid="filter-to" />
          </div>
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger className="w-full sm:w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {activeCats.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" size="sm" className="col-span-2 w-full sm:w-auto sm:ml-auto" onClick={() => window.print()} data-testid="button-print-expense-report">
            <Printer className="w-4 h-4 mr-1.5" /> Print
          </Button>
        </div>

        <div className="flex items-center justify-between text-sm border-b pb-2">
          <span className="text-muted-foreground">Total in range</span>
          <span className="text-lg sm:text-xl font-bold font-mono">{formatRs(list?.total ?? 0)}</span>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2 print:border-0 print:shadow-none">
            <CardHeader className="print:hidden">
              <CardTitle className="text-base flex items-center gap-2"><Receipt className="w-4 h-4" /> Expense Entries</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-12 text-center text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
              ) : (list?.items ?? []).length === 0 ? (
                <div className="p-12 text-center text-muted-foreground">No expenses in this range.</div>
              ) : (
                <>
                  {/* Mobile: stacked cards — the 7-column table doesn't fit a phone */}
                  <ul className="divide-y sm:hidden print:hidden">
                    {(list?.items ?? []).map((e) => (
                      <li key={e.id} className="p-3 space-y-1.5" data-testid={`row-expense-${e.id}`}>
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-mono font-semibold">{formatRs(e.amount)}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">{e.date}</span>
                            <Button size="icon" variant="ghost" className="h-7 w-7 -mr-1" onClick={() => handleDelete(e.id)} data-testid={`button-delete-expense-${e.id}`}>
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">{e.categoryName}</Badge>
                          <Badge variant="outline" className={MODE_TONE[e.paymentMode]}>{MODE_LABEL[e.paymentMode]}</Badge>
                          {e.paidTo && <span className="text-xs text-muted-foreground">→ {e.paidTo}</span>}
                        </div>
                        {e.notes && <p className="text-xs text-muted-foreground">{e.notes}</p>}
                      </li>
                    ))}
                  </ul>

                  {/* Tablet/desktop + print: full table */}
                  <div className="hidden sm:block print:block overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Category</TableHead>
                          <TableHead>Paid To</TableHead>
                          <TableHead>Mode</TableHead>
                          <TableHead>Notes</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead className="print:hidden"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(list?.items ?? []).map((e) => (
                          <TableRow key={e.id} data-testid={`row-expense-desktop-${e.id}`}>
                            <TableCell className="text-xs whitespace-nowrap">{e.date}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">{e.categoryName}</Badge>
                            </TableCell>
                            <TableCell className="text-sm">{e.paidTo || "—"}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className={MODE_TONE[e.paymentMode]}>{MODE_LABEL[e.paymentMode]}</Badge>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{e.notes || "—"}</TableCell>
                            <TableCell className="text-right font-mono font-medium whitespace-nowrap">{formatRs(e.amount)}</TableCell>
                            <TableCell className="print:hidden">
                              <Button size="sm" variant="ghost" onClick={() => handleDelete(e.id)} data-testid={`button-delete-expense-desktop-${e.id}`}>
                                <Trash2 className="w-4 h-4 text-destructive" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="print:border-0 print:shadow-none print:break-inside-avoid">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base flex items-center gap-2">
                {groupBy === "category" ? <Tag className="w-4 h-4" /> : <CalendarDays className="w-4 h-4" />}
                By {groupBy === "category" ? "Category" : "Date"}
              </CardTitle>
              <div className="flex gap-1 print:hidden">
                <Button
                  size="sm"
                  variant={groupBy === "category" ? "default" : "outline"}
                  className="h-7 px-2 text-xs"
                  onClick={() => setGroupBy("category")}
                  data-testid="button-group-by-category"
                >
                  Category
                </Button>
                <Button
                  size="sm"
                  variant={groupBy === "date" ? "default" : "outline"}
                  className="h-7 px-2 text-xs"
                  onClick={() => setGroupBy("date")}
                  data-testid="button-group-by-date"
                >
                  Date
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {groupBy === "category" ? (
                (list?.byCategory ?? []).length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-6">No data.</div>
                ) : (list?.byCategory ?? []).map((row) => {
                  const pct = (list?.total ?? 0) > 0 ? (row.total / (list?.total ?? 1)) * 100 : 0;
                  return (
                    <div key={`${row.categoryId}-${row.categoryName}`} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="font-medium">{row.categoryName}</span>
                        <span className="font-mono">{formatRs(row.total)}</span>
                      </div>
                      <div className="h-2 bg-muted rounded print:hidden">
                        <div className="h-full bg-primary rounded" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })
              ) : byDate.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-6">No data.</div>
              ) : byDate.map((row) => {
                const pct = (list?.total ?? 0) > 0 ? (row.total / (list?.total ?? 1)) * 100 : 0;
                return (
                  <div key={row.date} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium">{row.date}</span>
                      <span className="font-mono">{formatRs(row.total)}</span>
                    </div>
                    <div className="h-2 bg-muted rounded print:hidden">
                      <div className="h-full bg-primary rounded" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
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
