import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { eq, and } from "drizzle-orm";
import { db, pool, usersTable, entitiesTable } from "@workspace/db";
import {
  CreateUserBody,
  UpdateUserBody,
} from "@workspace/api-zod";
import { getCompanyId } from "../lib/tenant";

const router: IRouter = Router();

async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const session = (req as any).session;
  if (!session?.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  // Re-check DB on every admin call — don't trust the cookie's role/active fields,
  // which could be stale if another admin demoted or deactivated this user.
  const [current] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, session.userId));
  if (!current || !current.isActive || current.role !== "admin") {
    res.clearCookie("session", { path: "/" });
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}

function toPublic(u: typeof usersTable.$inferSelect) {
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    role: u.role,
    entityId: u.entityId,
    isActive: u.isActive,
    createdAt: u.createdAt.toISOString(),
  };
}

// Extract best-effort client IP from request headers (proxy-aware).
function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return (req as any).ip ?? (req.socket as any)?.remoteAddress ?? "unknown";
}

// Write a user-management audit entry. Fire-and-forget — never throws so that
// an audit-log failure never rolls back the actual operation.
async function writeAuditLog(params: {
  companyId: number;
  action: string;
  description: string;
  actorId: number;
  actorName: string;
  targetUsername: string;
  targetUserId: number;
  oldRole?: string | null;
  newRole?: string | null;
  ipAddress: string;
}): Promise<void> {
  try {
    const metadata = JSON.stringify({
      targetUsername: params.targetUsername,
      targetUserId: params.targetUserId,
      oldRole: params.oldRole ?? null,
      newRole: params.newRole ?? null,
      ipAddress: params.ipAddress,
    });
    await pool.query(
      `INSERT INTO audit_log (company_id, action, description, user_id, user_name, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        params.companyId,
        params.action,
        params.description,
        params.actorId,
        params.actorName,
        metadata,
      ]
    );
  } catch (err) {
    // Log but never propagate — audit must not break the primary operation.
    console.error("[audit_log] write failed", err);
  }
}

// GET /users — only users within the caller's company.
router.get("/users", requireAdmin, async (req, res): Promise<void> => {
  const companyId = getCompanyId(req);
  const users = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.companyId, companyId))
    .orderBy(usersTable.id);
  res.json(users.map(toPublic));
});

// POST /users
router.post("/users", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const companyId = getCompanyId(req);
  const session = (req as any).session;
  const { password, name, role, entityId } = parsed.data;
  const username = parsed.data.username.trim();
  if (username.length < 3) {
    res.status(400).json({ error: "Username must be at least 3 characters" });
    return;
  }

  // Usernames are unique within a company, not globally. Two companies can both
  // have a user named "admin" — they are different rows with different company_ids.
  // Scope the duplicate check to this company only.
  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.companyId, companyId), eq(usersTable.username, username)));
  if (existing) {
    res.status(409).json({ error: "Username already taken within this company" });
    return;
  }

  let resolvedName = name?.trim() ?? "";
  if (entityId != null) {
    const [ent] = await db
      .select()
      .from(entitiesTable)
      .where(and(eq(entitiesTable.companyId, companyId), eq(entitiesTable.id, entityId)));
    if (!ent) {
      res.status(400).json({ error: "Linked entity not found" });
      return;
    }
    if (!resolvedName) resolvedName = ent.name;
  }
  if (!resolvedName) {
    res.status(400).json({ error: "Name is required" });
    return;
  }

  try {
    const [created] = await db
      .insert(usersTable)
      .values({
        companyId,
        username,
        passwordHash: password, // dev mode — plaintext per replit.md
        name: resolvedName,
        role,
        entityId: entityId ?? null,
        isActive: true,
      })
      .returning();
    res.status(201).json(toPublic(created));

    // Audit: new user created.
    await writeAuditLog({
      companyId,
      action: "user_created",
      description: `User "${username}" created with role "${role}"`,
      actorId: session?.userId ?? 0,
      actorName: session?.name ?? session?.username ?? "Unknown",
      targetUsername: username,
      targetUserId: created.id,
      newRole: role,
      ipAddress: getClientIp(req),
    });
  } catch (err: any) {
    // Race condition: another admin may have just inserted the same username.
    if (err?.code === "23505") {
      res.status(409).json({ error: "Username already taken" });
      return;
    }
    throw err;
  }
});

// PATCH /users/:id
router.patch("/users/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const companyId = getCompanyId(req);
  const [existing] = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.companyId, companyId), eq(usersTable.id, id)));
  if (!existing) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  // Guard: don't let an admin lock themselves out.
  const session = (req as any).session;
  if (existing.id === session.userId && parsed.data.isActive === false) {
    res.status(400).json({ error: "You cannot deactivate your own account" });
    return;
  }
  if (existing.id === session.userId && parsed.data.role && parsed.data.role !== "admin") {
    res.status(400).json({ error: "You cannot change your own role" });
    return;
  }

  // Validate entityId exists when set to a non-null value (parity with create path)
  if (parsed.data.entityId !== undefined && parsed.data.entityId !== null) {
    const [ent] = await db
      .select({ id: entitiesTable.id })
      .from(entitiesTable)
      .where(and(eq(entitiesTable.companyId, companyId), eq(entitiesTable.id, parsed.data.entityId)));
    if (!ent) {
      res.status(400).json({ error: "Linked entity not found" });
      return;
    }
  }

  const patch: Partial<typeof usersTable.$inferInsert> = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name.trim();
  if (parsed.data.role !== undefined) patch.role = parsed.data.role;
  if (parsed.data.isActive !== undefined) patch.isActive = parsed.data.isActive;
  if (parsed.data.entityId !== undefined) patch.entityId = parsed.data.entityId;
  if (parsed.data.password !== undefined && parsed.data.password.length > 0) {
    patch.passwordHash = parsed.data.password;
  }

  const [updated] = await db
    .update(usersTable)
    .set(patch)
    .where(and(eq(usersTable.companyId, companyId), eq(usersTable.id, id)))
    .returning();

  res.json(toPublic(updated));

  // --- Audit entries (one per changed dimension) ---
  const ip = getClientIp(req);
  const actorId: number = session?.userId ?? 0;
  const actorName: string = session?.name ?? session?.username ?? "Unknown";

  if (parsed.data.password !== undefined && parsed.data.password.length > 0) {
    await writeAuditLog({
      companyId,
      action: "password_changed",
      description: `Password changed for user "${existing.username}" by "${actorName}"`,
      actorId,
      actorName,
      targetUsername: existing.username,
      targetUserId: existing.id,
      oldRole: existing.role,
      ipAddress: ip,
    });
  }

  if (parsed.data.role !== undefined && parsed.data.role !== existing.role) {
    await writeAuditLog({
      companyId,
      action: "role_changed",
      description: `Role changed for "${existing.username}": "${existing.role}" → "${parsed.data.role}"`,
      actorId,
      actorName,
      targetUsername: existing.username,
      targetUserId: existing.id,
      oldRole: existing.role,
      newRole: parsed.data.role,
      ipAddress: ip,
    });
  }

  if (parsed.data.isActive !== undefined && parsed.data.isActive !== existing.isActive) {
    const action = parsed.data.isActive ? "user_activated" : "user_deactivated";
    const verb = parsed.data.isActive ? "activated" : "deactivated";
    await writeAuditLog({
      companyId,
      action,
      description: `User "${existing.username}" was ${verb} by "${actorName}"`,
      actorId,
      actorName,
      targetUsername: existing.username,
      targetUserId: existing.id,
      oldRole: existing.role,
      ipAddress: ip,
    });
  }
});

export default router;
