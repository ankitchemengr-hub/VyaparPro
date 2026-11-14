import type { Request, Response, NextFunction } from "express";

// Route-level role gate. requireAuth (routes/index.ts) only proves someone is
// signed in; this decides WHICH roles may use a route. A platform super_admin
// passes wherever "admin" is allowed (it acts as the admin of the company it
// has opened, same as hasRole on the frontend).
export function sessionRole(req: Request): string | undefined {
  return (req as any).session?.role;
}

export function roleAllowed(role: string | undefined, roles: readonly string[]): boolean {
  if (!role) return false;
  if (roles.includes(role)) return true;
  return role === "super_admin" && roles.includes("admin");
}

export function requireRoles(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!roleAllowed(sessionRole(req), roles)) {
      res.status(403).json({ error: "You don't have access to this." });
      return;
    }
    next();
  };
}
