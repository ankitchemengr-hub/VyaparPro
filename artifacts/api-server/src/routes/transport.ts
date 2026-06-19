import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { getCompanyId } from "../lib/tenant";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const WRITE_ROLES = new Set(["admin"]);
const READ_ROLES  = new Set(["admin", "accountant"]);

function requireRead(req: any, res: any): boolean {
  const role = (req as any).session?.role;
  if (!role || !READ_ROLES.has(role)) { res.status(403).json({ error: "Forbidden" }); return false; }
  return true;
}
function requireWrite(req: any, res: any): boolean {
  const role = (req as any).session?.role;
  if (!role || !WRITE_ROLES.has(role)) { res.status(403).json({ error: "Forbidden — admin only" }); return false; }
  return true;
}

// ─────────────────────────────────────────────────────────────
// TRANSPORTERS
// ─────────────────────────────────────────────────────────────

// GET /transporters
router.get("/transporters", async (req, res): Promise<void> => {
  if (!requireRead(req, res)) return;
  const companyId = getCompanyId(req);
  try {
    const result = await pool.query(
      `SELECT * FROM transporters WHERE company_id = $1 ORDER BY is_active DESC, name ASC`,
      [companyId],
    );
    res.json(result.rows.map(fmtTransporter));
  } catch (err) {
    logger.error({ err }, "GET /transporters failed");
    res.status(500).json({ error: "Failed to fetch transporters" });
  }
});

// POST /transporters
router.post("/transporters", async (req, res): Promise<void> => {
  if (!requireWrite(req, res)) return;
  const companyId = getCompanyId(req);
  const { name, gstin, transporterId, contactName, contactMobile, notes } = req.body ?? {};
  if (!name?.trim()) { res.status(400).json({ error: "Name is required" }); return; }
  try {
    const result = await pool.query(
      `INSERT INTO transporters (company_id, name, gstin, transporter_id, contact_name, contact_mobile, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [companyId, name.trim(), gstin?.trim() || null, transporterId?.trim() || null,
       contactName?.trim() || null, contactMobile?.trim() || null, notes?.trim() || null],
    );
    res.status(201).json(fmtTransporter(result.rows[0]));
  } catch (err) {
    logger.error({ err }, "POST /transporters failed");
    res.status(500).json({ error: "Failed to create transporter" });
  }
});

// PUT /transporters/:id
router.put("/transporters/:id", async (req, res): Promise<void> => {
  if (!requireWrite(req, res)) return;
  const companyId = getCompanyId(req);
  const id = parseInt(req.params.id, 10);
  const { name, gstin, transporterId, contactName, contactMobile, notes, isActive } = req.body ?? {};
  if (!name?.trim()) { res.status(400).json({ error: "Name is required" }); return; }
  try {
    const result = await pool.query(
      `UPDATE transporters SET name=$1, gstin=$2, transporter_id=$3, contact_name=$4, contact_mobile=$5,
       notes=$6, is_active=$7, updated_at=NOW()
       WHERE company_id=$8 AND id=$9 RETURNING *`,
      [name.trim(), gstin?.trim() || null, transporterId?.trim() || null,
       contactName?.trim() || null, contactMobile?.trim() || null, notes?.trim() || null,
       isActive ?? true, companyId, id],
    );
    if (result.rows.length === 0) { res.status(404).json({ error: "Transporter not found" }); return; }
    res.json(fmtTransporter(result.rows[0]));
  } catch (err) {
    logger.error({ err }, "PUT /transporters/:id failed");
    res.status(500).json({ error: "Failed to update transporter" });
  }
});

function fmtTransporter(r: any) {
  return {
    id: r.id,
    companyId: r.company_id,
    name: r.name,
    gstin: r.gstin ?? null,
    transporterId: r.transporter_id ?? null,
    contactName: r.contact_name ?? null,
    contactMobile: r.contact_mobile ?? null,
    notes: r.notes ?? null,
    isActive: r.is_active,
    createdAt: r.created_at?.toISOString?.() ?? r.created_at,
    updatedAt: r.updated_at?.toISOString?.() ?? r.updated_at,
  };
}

// ─────────────────────────────────────────────────────────────
// VEHICLES
// ─────────────────────────────────────────────────────────────

// GET /vehicles
router.get("/vehicles", async (req, res): Promise<void> => {
  if (!requireRead(req, res)) return;
  const companyId = getCompanyId(req);
  try {
    const result = await pool.query(
      `SELECT * FROM vehicles WHERE company_id = $1 ORDER BY is_active DESC, vehicle_number ASC`,
      [companyId],
    );
    res.json(result.rows.map(fmtVehicle));
  } catch (err) {
    logger.error({ err }, "GET /vehicles failed");
    res.status(500).json({ error: "Failed to fetch vehicles" });
  }
});

// POST /vehicles
router.post("/vehicles", async (req, res): Promise<void> => {
  if (!requireWrite(req, res)) return;
  const companyId = getCompanyId(req);
  const { vehicleNumber, vehicleType, notes } = req.body ?? {};
  if (!vehicleNumber?.trim()) { res.status(400).json({ error: "Vehicle number is required" }); return; }
  try {
    const result = await pool.query(
      `INSERT INTO vehicles (company_id, vehicle_number, vehicle_type, notes) VALUES ($1,$2,$3,$4) RETURNING *`,
      [companyId, vehicleNumber.trim().toUpperCase(), vehicleType ?? "regular", notes?.trim() || null],
    );
    res.status(201).json(fmtVehicle(result.rows[0]));
  } catch (err) {
    logger.error({ err }, "POST /vehicles failed");
    res.status(500).json({ error: "Failed to create vehicle" });
  }
});

// PUT /vehicles/:id
router.put("/vehicles/:id", async (req, res): Promise<void> => {
  if (!requireWrite(req, res)) return;
  const companyId = getCompanyId(req);
  const id = parseInt(req.params.id, 10);
  const { vehicleNumber, vehicleType, notes, isActive } = req.body ?? {};
  if (!vehicleNumber?.trim()) { res.status(400).json({ error: "Vehicle number is required" }); return; }
  try {
    const result = await pool.query(
      `UPDATE vehicles SET vehicle_number=$1, vehicle_type=$2, notes=$3, is_active=$4
       WHERE company_id=$5 AND id=$6 RETURNING *`,
      [vehicleNumber.trim().toUpperCase(), vehicleType ?? "regular", notes?.trim() || null,
       isActive ?? true, companyId, id],
    );
    if (result.rows.length === 0) { res.status(404).json({ error: "Vehicle not found" }); return; }
    res.json(fmtVehicle(result.rows[0]));
  } catch (err) {
    logger.error({ err }, "PUT /vehicles/:id failed");
    res.status(500).json({ error: "Failed to update vehicle" });
  }
});

function fmtVehicle(r: any) {
  return {
    id: r.id,
    companyId: r.company_id,
    vehicleNumber: r.vehicle_number,
    vehicleType: r.vehicle_type,
    notes: r.notes ?? null,
    isActive: r.is_active,
    createdAt: r.created_at?.toISOString?.() ?? r.created_at,
  };
}

// ─────────────────────────────────────────────────────────────
// DISPATCHES
// ─────────────────────────────────────────────────────────────

// GET /dispatches
router.get("/dispatches", async (req, res): Promise<void> => {
  if (!requireRead(req, res)) return;
  const companyId = getCompanyId(req);
  const { invoiceId } = req.query as any;
  try {
    const params: any[] = [companyId];
    let whereExtra = "";
    if (invoiceId) { params.push(parseInt(invoiceId, 10)); whereExtra = ` AND d.invoice_id = $${params.length}`; }
    const result = await pool.query(
      `SELECT d.*, t.name AS t_name, t.gstin AS t_gstin, v.vehicle_number AS v_number
       FROM dispatches d
       LEFT JOIN transporters t ON t.id = d.transporter_id AND t.company_id = d.company_id
       LEFT JOIN vehicles v ON v.id = d.vehicle_id AND v.company_id = d.company_id
       WHERE d.company_id = $1${whereExtra}
       ORDER BY d.created_at DESC LIMIT 500`,
      params,
    );
    res.json(result.rows.map(fmtDispatch));
  } catch (err) {
    logger.error({ err }, "GET /dispatches failed");
    res.status(500).json({ error: "Failed to fetch dispatches" });
  }
});

// GET /dispatches/:id
router.get("/dispatches/:id", async (req, res): Promise<void> => {
  if (!requireRead(req, res)) return;
  const companyId = getCompanyId(req);
  const id = parseInt(req.params.id, 10);
  try {
    const result = await pool.query(
      `SELECT d.*, t.name AS t_name, t.gstin AS t_gstin, v.vehicle_number AS v_number
       FROM dispatches d
       LEFT JOIN transporters t ON t.id = d.transporter_id AND t.company_id = d.company_id
       LEFT JOIN vehicles v ON v.id = d.vehicle_id AND v.company_id = d.company_id
       WHERE d.company_id = $1 AND d.id = $2`,
      [companyId, id],
    );
    if (result.rows.length === 0) { res.status(404).json({ error: "Dispatch not found" }); return; }
    res.json(fmtDispatch(result.rows[0]));
  } catch (err) {
    logger.error({ err }, "GET /dispatches/:id failed");
    res.status(500).json({ error: "Failed to fetch dispatch" });
  }
});

// POST /dispatches
router.post("/dispatches", async (req, res): Promise<void> => {
  if (!requireWrite(req, res)) return;
  const companyId = getCompanyId(req);
  const session = (req as any).session;
  const {
    invoiceId, invoiceNo, transporterId, vehicleId,
    lrNumber, transportMode, distanceKm,
    ewayBillStatus, ewayBillNumber, ewayBillDate, ewayBillValidityDate, notes,
  } = req.body ?? {};

  try {
    // Snapshot transporter/vehicle names for audit
    let transporterName = null, transporterGstin = null, vehicleNumber = null;
    if (transporterId) {
      const tRes = await pool.query(`SELECT name, gstin FROM transporters WHERE id=$1 AND company_id=$2`, [transporterId, companyId]);
      if (tRes.rows[0]) { transporterName = tRes.rows[0].name; transporterGstin = tRes.rows[0].gstin; }
    }
    if (vehicleId) {
      const vRes = await pool.query(`SELECT vehicle_number FROM vehicles WHERE id=$1 AND company_id=$2`, [vehicleId, companyId]);
      if (vRes.rows[0]) { vehicleNumber = vRes.rows[0].vehicle_number; }
    }

    const result = await pool.query(
      `INSERT INTO dispatches
        (company_id, invoice_id, invoice_no, transporter_id, transporter_name, transporter_gstin,
         vehicle_id, vehicle_number, lr_number, transport_mode, distance_km,
         eway_bill_status, eway_bill_number, eway_bill_date, eway_bill_validity_date, notes, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [
        companyId, invoiceId ?? null, invoiceNo?.trim() || null,
        transporterId ?? null, transporterName, transporterGstin,
        vehicleId ?? null, vehicleNumber,
        lrNumber?.trim() || null, transportMode ?? "road",
        distanceKm ? parseInt(distanceKm, 10) : null,
        ewayBillStatus ?? "pending",
        ewayBillNumber?.trim() || null,
        ewayBillDate ? new Date(ewayBillDate) : null,
        ewayBillValidityDate ? new Date(ewayBillValidityDate) : null,
        notes?.trim() || null,
        session?.userId ?? null,
      ],
    );
    res.status(201).json(fmtDispatch(result.rows[0]));
  } catch (err) {
    logger.error({ err }, "POST /dispatches failed");
    res.status(500).json({ error: "Failed to create dispatch" });
  }
});

// PUT /dispatches/:id
router.put("/dispatches/:id", async (req, res): Promise<void> => {
  if (!requireWrite(req, res)) return;
  const companyId = getCompanyId(req);
  const id = parseInt(req.params.id, 10);
  const {
    transporterId, vehicleId,
    lrNumber, transportMode, distanceKm,
    ewayBillStatus, ewayBillNumber, ewayBillDate, ewayBillValidityDate, notes,
  } = req.body ?? {};

  try {
    let transporterName = null, transporterGstin = null, vehicleNumber = null;
    if (transporterId) {
      const tRes = await pool.query(`SELECT name, gstin FROM transporters WHERE id=$1 AND company_id=$2`, [transporterId, companyId]);
      if (tRes.rows[0]) { transporterName = tRes.rows[0].name; transporterGstin = tRes.rows[0].gstin; }
    }
    if (vehicleId) {
      const vRes = await pool.query(`SELECT vehicle_number FROM vehicles WHERE id=$1 AND company_id=$2`, [vehicleId, companyId]);
      if (vRes.rows[0]) { vehicleNumber = vRes.rows[0].vehicle_number; }
    }

    const result = await pool.query(
      `UPDATE dispatches SET
        transporter_id=$1, transporter_name=$2, transporter_gstin=$3,
        vehicle_id=$4, vehicle_number=$5,
        lr_number=$6, transport_mode=$7, distance_km=$8,
        eway_bill_status=$9, eway_bill_number=$10, eway_bill_date=$11, eway_bill_validity_date=$12,
        notes=$13, updated_at=NOW()
       WHERE company_id=$14 AND id=$15 RETURNING *`,
      [
        transporterId ?? null, transporterName, transporterGstin,
        vehicleId ?? null, vehicleNumber,
        lrNumber?.trim() || null, transportMode ?? "road",
        distanceKm ? parseInt(distanceKm, 10) : null,
        ewayBillStatus ?? "pending",
        ewayBillNumber?.trim() || null,
        ewayBillDate ? new Date(ewayBillDate) : null,
        ewayBillValidityDate ? new Date(ewayBillValidityDate) : null,
        notes?.trim() || null,
        companyId, id,
      ],
    );
    if (result.rows.length === 0) { res.status(404).json({ error: "Dispatch not found" }); return; }
    res.json(fmtDispatch(result.rows[0]));
  } catch (err) {
    logger.error({ err }, "PUT /dispatches/:id failed");
    res.status(500).json({ error: "Failed to update dispatch" });
  }
});

function fmtDispatch(r: any) {
  return {
    id: r.id,
    companyId: r.company_id,
    invoiceId: r.invoice_id ?? null,
    invoiceNo: r.invoice_no ?? null,
    transporterId: r.transporter_id ?? null,
    transporterName: r.transporter_name ?? r.t_name ?? null,
    transporterGstin: r.transporter_gstin ?? r.t_gstin ?? null,
    vehicleId: r.vehicle_id ?? null,
    vehicleNumber: r.vehicle_number ?? r.v_number ?? null,
    lrNumber: r.lr_number ?? null,
    transportMode: r.transport_mode ?? "road",
    distanceKm: r.distance_km ?? null,
    ewayBillStatus: r.eway_bill_status ?? "pending",
    ewayBillNumber: r.eway_bill_number ?? null,
    ewayBillDate: r.eway_bill_date?.toISOString?.() ?? r.eway_bill_date ?? null,
    ewayBillValidityDate: r.eway_bill_validity_date?.toISOString?.() ?? r.eway_bill_validity_date ?? null,
    notes: r.notes ?? null,
    createdByUserId: r.created_by_user_id ?? null,
    createdAt: r.created_at?.toISOString?.() ?? r.created_at,
    updatedAt: r.updated_at?.toISOString?.() ?? r.updated_at,
  };
}

export default router;
