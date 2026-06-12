import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";

export const auditLogTable = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  action: text("action").notNull(),
  description: text("description"),
  userId: integer("user_id").notNull(),
  userName: text("user_name"),
  metadata: text("metadata"), // JSON string
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("audit_log_company_idx").on(t.companyId),
  index("audit_log_user_idx").on(t.userId),
  index("audit_log_action_idx").on(t.action),
]);

export type AuditEntry = typeof auditLogTable.$inferSelect;
