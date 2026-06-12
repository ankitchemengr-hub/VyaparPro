import { Router, type IRouter } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { workersTable, workerAttendanceTable, workerPaymentsTable } from "@workspace/db";
import {
  CreateWorkerBody,
  UpdateWorkerBody,
  UpdateWorkerParams,
  DeleteWorkerParams,
  GetWorkerLedgerParams,
  ListWorkersQueryParams,
  ListWorkerAttendanceQueryParams,
  UpsertWorkerAttendanceBody,
  CreateWorkerPaymentBody,
} from "@workspace/api-zod";
import { getCompanyId } from "../lib/tenant";

const router: IRouter = Router();

const WRITE_ROLES = new Set(["admin", "accountant"]);
const READ_ROLES = new Set(["admin", "accountant", "store", "manufacturing"]);

function requireRead(req: any, res: any): boolean {
  const role = (req as any).session?.role;
  if (!role || !READ_ROLES.has(role)) {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}
function requireWrite(req: any, res: any): boolean {
  const role = (req as any).session?.role;
  if (!role || !WRITE_ROLES.has(role)) {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

function formatWorker(w: any) {
  return {
    id: w.id,
    name: w.name,
    phone: w.phone ?? null,
    skill: w.skill ?? null,
    dailyWage: Number(w.dailyWage ?? w.daily_wage ?? 0),
    joinedAt: w.joinedAt ?? w.joined_at ?? null,
    isActive: w.isActive ?? w.is_active ?? true,
    notes: w.notes ?? null,
    createdAt: (w.createdAt ?? w.created_at)?.toISOString
      ? (w.createdAt ?? w.created_at).toISOString()
      : (w.createdAt ?? w.created_at),
  };
}

function formatAttendance(a: any, workerName?: string | null) {
  return {
    id: a.id,
    workerId: a.workerId ?? a.worker_id,
    workerName: workerName ?? null,
    date: a.date,
    status: a.status,
    wageAmount: Number(a.wageAmount ?? a.wage_amount ?? 0),
    notes: a.notes ?? null,
    createdAt: (a.createdAt ?? a.created_at)?.toISOString
      ? (a.createdAt ?? a.created_at).toISOString()
      : (a.createdAt ?? a.created_at),
  };
}

function formatPayment(p: any) {
  return {
    id: p.id,
    workerId: p.workerId ?? p.worker_id,
    amount: Number(p.amount),
    paidOn: p.paidOn ?? p.paid_on,
    paymentMode: p.paymentMode ?? p.payment_mode,
    notes: p.notes ?? null,
    createdAt: (p.createdAt ?? p.created_at)?.toISOString
      ? (p.createdAt ?? p.created_at).toISOString()
      : (p.createdAt ?? p.created_at),
  };
}

function computeWage(dailyWage: number, status: string): number {
  if (status === "present") return dailyWage;
  if (status === "half_day") return dailyWage / 2;
  return 0;
}

// GET /workers
router.get("/workers", async (req, res): Promise<void> => {
  if (!requireRead(req, res)) return;
  const parsed = ListWorkersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const companyId = getCompanyId(req);
  const includeInactive = parsed.data.includeInactive ?? false;
  const rows = await db
    .select()
    .from(workersTable)
    .where(
      includeInactive
        ? eq(workersTable.companyId, companyId)
        : and(eq(workersTable.companyId, companyId), eq(workersTable.isActive, true))
    )
    .orderBy(sql`${workersTable.isActive} DESC, ${workersTable.name}`);
  res.json(rows.map(formatWorker));
});

// POST /workers
router.post("/workers", async (req, res): Promise<void> => {
  if (!requireWrite(req, res)) return;
  const parsed = CreateWorkerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const companyId = getCompanyId(req);
  const [created] = await db
    .insert(workersTable)
    .values({
      companyId,
      name: parsed.data.name,
      phone: parsed.data.phone ?? null,
      skill: parsed.data.skill ?? null,
      dailyWage: String(parsed.data.dailyWage),
      joinedAt: parsed.data.joinedAt ?? null,
      isActive: parsed.data.isActive ?? true,
      notes: parsed.data.notes ?? null,
    })
    .returning();
  res.status(201).json(formatWorker(created));
});

// PATCH /workers/:id
router.patch("/workers/:id", async (req, res): Promise<void> => {
  if (!requireWrite(req, res)) return;
  const params = UpdateWorkerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateWorkerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const companyId = getCompanyId(req);
  const [updated] = await db
    .update(workersTable)
    .set({
      name: parsed.data.name,
      phone: parsed.data.phone ?? null,
      skill: parsed.data.skill ?? null,
      dailyWage: String(parsed.data.dailyWage),
      joinedAt: parsed.data.joinedAt ?? null,
      isActive: parsed.data.isActive ?? true,
      notes: parsed.data.notes ?? null,
    })
    .where(and(eq(workersTable.companyId, companyId), eq(workersTable.id, params.data.id)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Worker not found" });
    return;
  }
  res.json(formatWorker(updated));
});

// DELETE /workers/:id (soft)
router.delete("/workers/:id", async (req, res): Promise<void> => {
  if (!requireWrite(req, res)) return;
  const params = DeleteWorkerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const companyId = getCompanyId(req);
  await db
    .update(workersTable)
    .set({ isActive: false })
    .where(and(eq(workersTable.companyId, companyId), eq(workersTable.id, params.data.id)));
  res.sendStatus(204);
});

// GET /workers/:id/ledger
router.get("/workers/:id/ledger", async (req, res): Promise<void> => {
  if (!requireRead(req, res)) return;
  const params = GetWorkerLedgerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const companyId = getCompanyId(req);
  const workerId = params.data.id;
  const [worker] = await db
    .select()
    .from(workersTable)
    .where(and(eq(workersTable.companyId, companyId), eq(workersTable.id, workerId)));
  if (!worker) {
    res.status(404).json({ error: "Worker not found" });
    return;
  }
  const attendance = await db
    .select()
    .from(workerAttendanceTable)
    .where(and(eq(workerAttendanceTable.companyId, companyId), eq(workerAttendanceTable.workerId, workerId)))
    .orderBy(workerAttendanceTable.date);
  const payments = await db
    .select()
    .from(workerPaymentsTable)
    .where(and(eq(workerPaymentsTable.companyId, companyId), eq(workerPaymentsTable.workerId, workerId)))
    .orderBy(workerPaymentsTable.paidOn);

  type Entry = { date: string; kind: "attendance" | "payment"; status: string | null; amount: number; notes: string | null; sortKey: number };
  const entries: Entry[] = [];
  for (const a of attendance) {
    entries.push({
      date: a.date as unknown as string,
      kind: "attendance",
      status: a.status,
      amount: Number(a.wageAmount),
      notes: a.notes,
      sortKey: 0,
    });
  }
  for (const p of payments) {
    entries.push({
      date: p.paidOn as unknown as string,
      kind: "payment",
      status: p.paymentMode,
      amount: -Number(p.amount),
      notes: p.notes,
      sortKey: 1,
    });
  }
  entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.sortKey - b.sortKey));

  let running = 0;
  const totalEarned = attendance.reduce((s, a) => s + Number(a.wageAmount), 0);
  const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0);
  const out = entries.map((e) => {
    running += e.amount;
    return {
      date: e.date,
      kind: e.kind,
      status: e.status,
      amount: e.amount,
      balance: running,
      notes: e.notes,
    };
  });
  res.json({
    workerId,
    workerName: worker.name,
    totalEarned,
    totalPaid,
    balance: totalEarned - totalPaid,
    entries: out,
  });
});

// GET /worker-attendance?date=YYYY-MM-DD
router.get("/worker-attendance", async (req, res): Promise<void> => {
  if (!requireRead(req, res)) return;
  const parsed = ListWorkerAttendanceQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const companyId = getCompanyId(req);
  const rows = await db
    .select({
      id: workerAttendanceTable.id,
      workerId: workerAttendanceTable.workerId,
      workerName: workersTable.name,
      date: workerAttendanceTable.date,
      status: workerAttendanceTable.status,
      wageAmount: workerAttendanceTable.wageAmount,
      notes: workerAttendanceTable.notes,
      createdAt: workerAttendanceTable.createdAt,
    })
    .from(workerAttendanceTable)
    .leftJoin(workersTable, eq(workersTable.id, workerAttendanceTable.workerId))
    .where(and(eq(workerAttendanceTable.companyId, companyId), eq(workerAttendanceTable.date, parsed.data.date)));
  res.json(rows.map((r) => formatAttendance(r, r.workerName)));
});

// POST /worker-attendance  (upsert)
router.post("/worker-attendance", async (req, res): Promise<void> => {
  if (!requireWrite(req, res)) return;
  const parsed = UpsertWorkerAttendanceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const companyId = getCompanyId(req);
  const [worker] = await db
    .select()
    .from(workersTable)
    .where(and(eq(workersTable.companyId, companyId), eq(workersTable.id, parsed.data.workerId)));
  if (!worker) {
    res.status(404).json({ error: "Worker not found" });
    return;
  }
  const wage = computeWage(Number(worker.dailyWage), parsed.data.status);

  // Atomic upsert on (worker_id, date)
  const [saved] = await db
    .insert(workerAttendanceTable)
    .values({
      companyId,
      workerId: parsed.data.workerId,
      date: parsed.data.date,
      status: parsed.data.status,
      wageAmount: String(wage),
      notes: parsed.data.notes ?? null,
    })
    .onConflictDoUpdate({
      target: [workerAttendanceTable.workerId, workerAttendanceTable.date],
      set: {
        status: parsed.data.status,
        wageAmount: String(wage),
        notes: parsed.data.notes ?? null,
      },
    })
    .returning();
  res.json(formatAttendance(saved, worker.name));
});

// POST /worker-payments
router.post("/worker-payments", async (req, res): Promise<void> => {
  if (!requireWrite(req, res)) return;
  const parsed = CreateWorkerPaymentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const companyId = getCompanyId(req);
  const [worker] = await db
    .select()
    .from(workersTable)
    .where(and(eq(workersTable.companyId, companyId), eq(workersTable.id, parsed.data.workerId)));
  if (!worker) {
    res.status(404).json({ error: "Worker not found" });
    return;
  }
  const [created] = await db
    .insert(workerPaymentsTable)
    .values({
      companyId,
      workerId: parsed.data.workerId,
      amount: String(parsed.data.amount),
      paidOn: parsed.data.paidOn,
      paymentMode: parsed.data.paymentMode,
      notes: parsed.data.notes ?? null,
    })
    .returning();
  res.status(201).json(formatPayment(created));
});

export default router;
