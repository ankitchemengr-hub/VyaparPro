import { Router, type IRouter } from "express";
import { eq, ilike, and, sql, or, ne } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import { entitiesTable, ledgerEntriesTable } from "@workspace/db";
import {
  ListEntitiesQueryParams,
  CreateEntityBody,
  LookupEntityByMobileQueryParams,
  GetEntityParams,
  UpdateEntityParams,
  UpdateEntityBody,
  GetEntityLedgerParams,
  CreateLedgerAdjustmentParams,
  CreateLedgerAdjustmentBody,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { getCompanyId } from "../lib/tenant";

const router: IRouter = Router();

// GET /entities/lookup
router.get("/entities/lookup", async (req, res): Promise<void> => {
  const params = LookupEntityByMobileQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const companyId = getCompanyId(req);
  const [entity] = await db
    .select()
    .from(entitiesTable)
    .where(and(eq(entitiesTable.companyId, companyId), eq(entitiesTable.mobile, params.data.mobile)));

  if (!entity) {
    res.json({ found: false });
    return;
  }

  res.json({ found: true, entity: formatEntity(entity) });
});

// GET /entities
router.get("/entities", async (req, res): Promise<void> => {
  const params = ListEntitiesQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const companyId = getCompanyId(req);
  const conditions: any[] = [eq(entitiesTable.companyId, companyId)];
  if (params.data.type) conditions.push(eq(entitiesTable.type, params.data.type));
  if (params.data.mobile) conditions.push(eq(entitiesTable.mobile, params.data.mobile));
  if (params.data.search) {
    conditions.push(
      or(
        ilike(entitiesTable.name, `%${params.data.search}%`),
        ilike(entitiesTable.mobile, `%${params.data.search}%`),
        ilike(entitiesTable.gstin ?? sql`''`, `%${params.data.search}%`)
      )
    );
  }

  const entities = await db
    .select()
    .from(entitiesTable)
    .where(and(...conditions))
    .orderBy(entitiesTable.name);

  res.json(entities.map(formatEntity));
});

// POST /entities
router.post("/entities", async (req, res): Promise<void> => {
  const parsed = CreateEntityBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const companyId = getCompanyId(req);
  const pricingTier = parsed.data.pricingTier ?? "retail";
  let name = parsed.data.name?.trim() ?? "";

  // Canonical rule: name is required for everyone EXCEPT retail customers (walk-ins).
  // Wholesale customers, vendors, workers, and salesmen always need a real name
  // because they are surfaced on invoices, purchase orders, job cards, etc.
  const isRetailCustomer = parsed.data.type === "customer" && pricingTier === "retail";
  if (!name && !isRetailCustomer) {
    const pluralMap: Record<string, string> = {
      customer: "wholesale customers",
      vendor: "vendors",
      worker: "workers",
      salesman: "salesmen",
    };
    const typeLabel = pluralMap[parsed.data.type] ?? `${parsed.data.type}s`;
    res.status(400).json({ error: `Name is required for ${typeLabel}` });
    return;
  }
  // Retail walk-ins can omit name — fall back to a mobile-based label.
  if (!name) {
    name = `Retail Customer (${parsed.data.mobile})`;
  }

  // Prevent duplicate contacts: same mobile for the same entity type in this company.
  const [dupe] = await db
    .select({ id: entitiesTable.id })
    .from(entitiesTable)
    .where(
      and(
        eq(entitiesTable.companyId, companyId),
        eq(entitiesTable.type, parsed.data.type),
        eq(entitiesTable.mobile, parsed.data.mobile),
      ),
    );
  if (dupe) {
    res.status(409).json({ error: `A ${parsed.data.type} with mobile ${parsed.data.mobile} already exists` });
    return;
  }

  const [entity] = await db
    .insert(entitiesTable)
    .values({
      ...parsed.data,
      companyId,
      name,
      pricingTier,
      creditLimit: parsed.data.creditLimit != null ? String(parsed.data.creditLimit) : null,
    })
    .returning();

  res.status(201).json(formatEntity(entity));
});

// GET /entities/:id
router.get("/entities/:id", async (req, res): Promise<void> => {
  const params = GetEntityParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const companyId = getCompanyId(req);
  const [entity] = await db
    .select()
    .from(entitiesTable)
    .where(and(eq(entitiesTable.companyId, companyId), eq(entitiesTable.id, params.data.id)));

  if (!entity) {
    res.status(404).json({ error: "Entity not found" });
    return;
  }

  res.json(formatEntity(entity));
});

// PATCH /entities/:id
router.patch("/entities/:id", async (req, res): Promise<void> => {
  const params = UpdateEntityParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateEntityBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const companyId = getCompanyId(req);

  // If mobile or type is changing, ensure it doesn't collide with another contact.
  if (parsed.data.mobile != null || parsed.data.type != null) {
    const [current] = await db
      .select({ type: entitiesTable.type, mobile: entitiesTable.mobile })
      .from(entitiesTable)
      .where(and(eq(entitiesTable.companyId, companyId), eq(entitiesTable.id, params.data.id)));
    if (!current) {
      res.status(404).json({ error: "Entity not found" });
      return;
    }
    const effType = parsed.data.type ?? current.type;
    const effMobile = parsed.data.mobile ?? current.mobile;
    const [dupe] = await db
      .select({ id: entitiesTable.id })
      .from(entitiesTable)
      .where(
        and(
          eq(entitiesTable.companyId, companyId),
          eq(entitiesTable.type, effType),
          eq(entitiesTable.mobile, effMobile),
          ne(entitiesTable.id, params.data.id),
        ),
      );
    if (dupe) {
      res.status(409).json({ error: `A ${effType} with mobile ${effMobile} already exists` });
      return;
    }
  }

  const [entity] = await db
    .update(entitiesTable)
    .set({
      ...parsed.data,
      creditLimit: parsed.data.creditLimit != null ? String(parsed.data.creditLimit) : undefined,
    })
    .where(and(eq(entitiesTable.companyId, companyId), eq(entitiesTable.id, params.data.id)))
    .returning();

  if (!entity) {
    res.status(404).json({ error: "Entity not found" });
    return;
  }

  res.json(formatEntity(entity));
});

// GET /entities/:id/ledger
router.get("/entities/:id/ledger", async (req, res): Promise<void> => {
  const params = GetEntityLedgerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const companyId = getCompanyId(req);
  const [entity] = await db
    .select()
    .from(entitiesTable)
    .where(and(eq(entitiesTable.companyId, companyId), eq(entitiesTable.id, params.data.id)));

  if (!entity) {
    res.status(404).json({ error: "Entity not found" });
    return;
  }

  const entries = await db
    .select()
    .from(ledgerEntriesTable)
    .where(and(eq(ledgerEntriesTable.companyId, companyId), eq(ledgerEntriesTable.entityId, params.data.id)))
    .orderBy(sql`${ledgerEntriesTable.date} DESC`);

  res.json({
    entity: formatEntity(entity),
    outstandingBalance: Number(entity.outstandingBalance),
    entries: entries.map(formatLedgerEntry),
  });
});

// POST /entities/:id/ledger — manual credit/debit adjustment to a customer khata.
// A "debit" increases what the customer owes (outstanding +); a "credit" reduces it (outstanding -).
router.post("/entities/:id/ledger", async (req, res): Promise<void> => {
  const params = CreateLedgerAdjustmentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = CreateLedgerAdjustmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const session = (req as any).session;
  const role = session?.role;
  if (role !== "admin" && role !== "accountant") {
    res.status(403).json({ error: "Only admin or accountant can adjust a ledger" });
    return;
  }

  const { direction, amount, notes, attachmentUrl } = parsed.data;
  if (amount <= 0) {
    res.status(400).json({ error: "Amount must be greater than zero" });
    return;
  }

  // Validate the attachment server-side — the client checks are bypassable via a
  // direct API call, so re-enforce image mime type + decoded size to prevent DB bloat.
  if (attachmentUrl) {
    const match = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
      attachmentUrl,
    );
    if (!match) {
      res.status(400).json({ error: "Attachment must be a base64 PNG, JPEG, WEBP or GIF image" });
      return;
    }
    const decodedBytes = Math.floor((match[2].length * 3) / 4);
    if (decodedBytes > 3 * 1024 * 1024) {
      res.status(400).json({ error: "Attachment must be under 3MB" });
      return;
    }
  }

  const companyId = getCompanyId(req);
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");

    const existing = await client.query(
      `SELECT id, name FROM entities WHERE company_id = $1 AND id = $2`,
      [companyId, params.data.id],
    );
    if (existing.rowCount === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Entity not found" });
      return;
    }

    const delta = direction === "debit" ? amount : -amount;
    const balResult = await client.query(
      `UPDATE entities SET outstanding_balance = outstanding_balance + $1 WHERE company_id = $2 AND id = $3
       RETURNING outstanding_balance`,
      [delta, companyId, params.data.id],
    );
    const newBal = balResult.rows[0].outstanding_balance;

    const description =
      notes && notes.trim().length > 0
        ? notes.trim()
        : direction === "debit"
          ? "Manual debit adjustment"
          : "Manual credit adjustment";
    const referenceNo = `ADJ-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const inserted = await client.query(
      `INSERT INTO ledger_entries
         (company_id, entity_id, date, description, debit, credit, balance, type, reference_no, attachment_url, created_by_id, created_by_name)
       VALUES ($1, $2, NOW(), $3, $4, $5, $6, 'adjustment', $7, $8, $9, $10)
       RETURNING *`,
      [
        companyId,
        params.data.id,
        description,
        direction === "debit" ? amount : 0,
        direction === "credit" ? amount : 0,
        newBal,
        referenceNo,
        attachmentUrl ?? null,
        session?.userId ?? null,
        session?.name ?? null,
      ],
    );

    await client.query("COMMIT");
    res.status(201).json(formatLedgerEntry(mapLedgerRow(inserted.rows[0])));
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error({ err }, "Failed to create ledger adjustment");
    res.status(500).json({ error: "Failed to create ledger adjustment" });
  } finally {
    client.release();
  }
});

// The raw pg row uses snake_case; map it to the camelCase shape formatLedgerEntry expects.
function mapLedgerRow(r: any) {
  return {
    id: r.id,
    date: r.date,
    description: r.description,
    debit: r.debit,
    credit: r.credit,
    balance: r.balance,
    type: r.type,
    referenceId: r.reference_id,
    referenceNo: r.reference_no,
    attachmentUrl: r.attachment_url,
    createdByName: r.created_by_name,
  };
}

function formatEntity(e: any) {
  return {
    id: e.id,
    type: e.type,
    name: e.name,
    mobile: e.mobile,
    gstin: e.gstin ?? null,
    address: e.address ?? null,
    city: e.city ?? null,
    state: e.state ?? null,
    district: e.district ?? null,
    area: e.area ?? null,
    pinCode: e.pinCode ?? null,
    gpsLocation: e.gpsLocation ?? null,
    pricingTier: e.pricingTier ?? null,
    outstandingBalance: Number(e.outstandingBalance ?? 0),
    creditLimit: e.creditLimit != null ? Number(e.creditLimit) : null,
    userId: e.userId ?? null,
    createdAt: e.createdAt?.toISOString(),
  };
}

function formatLedgerEntry(e: any) {
  return {
    id: e.id,
    date: e.date?.toISOString(),
    description: e.description,
    debit: Number(e.debit),
    credit: Number(e.credit),
    balance: Number(e.balance),
    type: e.type,
    referenceId: e.referenceId ?? null,
    referenceNo: e.referenceNo ?? null,
    attachmentUrl: e.attachmentUrl ?? null,
    createdByName: e.createdByName ?? null,
  };
}

export default router;
