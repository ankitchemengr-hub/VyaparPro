// Customer custom domains ("erp.myshop.com" opens that company's ERP).
//
// Each company has at most ONE active domain and ONE pending domain in
// company_domains (enforced by partial unique indexes in bootstrap.ts). A
// change of domain is a new pending row: the old active domain keeps working
// until the new one's DNS verifies, then the old one is removed — so the
// customer is never left without a working link.
//
// companies.custom_domain / custom_domain_status mirror the current state
// (active domain, else pending) for older code and the bootstrap backfill;
// always change domains through this module so the mirror stays in sync.
import dns from "node:dns/promises";
import { pool } from "@workspace/db";
import { logger } from "./logger";
import { sendMail, adminNotifyEmail } from "./mailer";
import {
  railwayConfigured, railwayAddDomain, railwayGetDomain, railwayRemoveDomain, type DnsRecord,
} from "./railway";

export interface DomainRow {
  id: number;
  company_id: number;
  domain: string;
  status: "pending" | "active";
  railway_domain_id: string | null;
  dns_records: DnsRecord[];
  certificate_status: string | null;
  last_checked_at: Date | null;
  last_error: string | null;
  dns_verified_at: Date | null;
  activated_at: Date | null;
  created_at: Date;
}

export class DomainError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

// ── Platform host / validation ─────────────────────────────────────────────

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

// Where customers' CNAMEs point when Railway isn't wired up to hand us a
// per-domain target. APP_PUBLIC_HOST wins; else the ERP URL's host; else
// Railway's own generated domain for this service.
export function appPublicHost(): string | null {
  return (
    hostOf(process.env["APP_PUBLIC_HOST"]) ??
    hostOf(process.env["ERP_APPLICATION_URL"]) ??
    hostOf(process.env["RAILWAY_PUBLIC_DOMAIN"])
  );
}

function platformHosts(): string[] {
  return [
    appPublicHost(),
    hostOf(process.env["ERP_APPLICATION_URL"]),
    hostOf(process.env["PORTAL_APPLICATION_URL"]),
    hostOf(process.env["RAILWAY_PUBLIC_DOMAIN"]),
  ].filter((h): h is string => !!h);
}

const DOMAIN_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*\.[a-z]{2,63}$/;

// Accepts what customers actually paste ("https://www.MyShop.com/login") and
// reduces it to a bare hostname, or throws a friendly error.
export function normalizeDomain(input: unknown): string {
  if (typeof input !== "string" || !input.trim()) throw new DomainError("Please enter a domain, e.g. erp.myshop.com");
  let d = input.trim().toLowerCase();
  d = d.replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0]!.split(":")[0]!.replace(/\.$/, "");
  if (d.length > 253 || !DOMAIN_RE.test(d)) {
    throw new DomainError("That doesn't look like a valid domain (e.g. erp.myshop.com)");
  }
  if (d === "localhost" || /\.(railway\.app|up\.railway\.app|vercel\.app)$/.test(d) || platformHosts().includes(d)) {
    throw new DomainError("Please enter a domain you own — not one of our own addresses");
  }
  return d;
}

// Second-level suffixes where the "root" is three labels (myshop.co.in).
const MULTI_PART_SUFFIXES = new Set([
  "co.in", "net.in", "org.in", "firm.in", "gen.in", "ind.in", "ac.in", "edu.in", "gov.in",
  "co.uk", "org.uk", "com.au", "net.au", "co.nz", "com.sg", "co.za", "com.br",
]);

// Number of labels in the registrable root: 2 for myshop.com, 3 for myshop.co.in.
function rootLabelCount(domain: string): number {
  return MULTI_PART_SUFFIXES.has(domain.split(".").slice(-2).join(".")) ? 3 : 2;
}

// True for "myshop.com" / "myshop.co.in"; false for "erp.myshop.com".
export function isRootDomain(domain: string): boolean {
  return domain.split(".").length <= rootLabelCount(domain);
}

// The "Name/Host" a registrar's DNS screen wants: "erp" for erp.myshop.com,
// "@" for the root itself.
function hostLabel(domain: string): string {
  const parts = domain.split(".");
  return parts.slice(0, Math.max(0, parts.length - rootLabelCount(domain))).join(".") || "@";
}

// Records to show when Railway isn't configured (or hasn't answered yet).
function fallbackRecords(domain: string): DnsRecord[] {
  const target = appPublicHost();
  if (!target) return [];
  return [{ type: "CNAME", name: hostLabel(domain), fqdn: domain, value: target, current: null, ok: null }];
}

// ── DNS check ──────────────────────────────────────────────────────────────

const clean = (s: string) => s.toLowerCase().replace(/\.$/, "");

// The host a request arrived on. Behind Railway's proxy the original host is
// in X-Forwarded-Host (first value when chained).
export function requestHost(req: { headers: Record<string, string | string[] | undefined> }): string | undefined {
  const fwd = req.headers["x-forwarded-host"];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0]?.trim();
  const host = req.headers["host"];
  return first || (Array.isArray(host) ? host[0] : host);
}

async function checkRecord(r: DnsRecord): Promise<DnsRecord> {
  const want = clean(r.value);
  try {
    if (r.type === "TXT") {
      const txt = (await dns.resolveTxt(r.fqdn)).map((chunks) => chunks.join(""));
      return { ...r, current: txt.join(", ") || null, ok: txt.some((t) => t.trim() === r.value.trim()) };
    }
    if (r.type === "A") {
      const a = await dns.resolve4(r.fqdn);
      return { ...r, current: a.join(", ") || null, ok: a.includes(r.value) };
    }
    // CNAME. A root domain can't hold a real CNAME, so registrars that support
    // "CNAME flattening"/ALIAS answer with A records instead — accept that
    // when those IPs match what the target itself resolves to.
    try {
      const cn = (await dns.resolveCname(r.fqdn)).map(clean);
      if (cn.length) return { ...r, current: cn.join(", "), ok: cn.includes(want) };
    } catch {
      /* no CNAME — try the flattened form below */
    }
    const [mine, theirs] = await Promise.all([
      dns.resolve4(r.fqdn).catch(() => [] as string[]),
      dns.resolve4(want).catch(() => [] as string[]),
    ]);
    const ok = mine.length > 0 && mine.every((ip) => theirs.includes(ip));
    return { ...r, current: mine.join(", ") || null, ok };
  } catch {
    return { ...r, current: null, ok: false };
  }
}

// ── Host → company lookup (used by /system/config) ─────────────────────────

const hostCache = new Map<string, { companyId: number | null; at: number }>();
const HOST_TTL_MS = 60_000;

export function clearDomainCache(): void {
  hostCache.clear();
}

export async function companyIdForHost(rawHost: string | undefined): Promise<number | null> {
  if (!rawHost) return null;
  const host = clean(rawHost.split(":")[0]!);
  const hit = hostCache.get(host);
  if (hit && Date.now() - hit.at < HOST_TTL_MS) return hit.companyId;
  const { rows } = await pool.query(
    `SELECT company_id FROM company_domains WHERE domain = $1 AND status = 'active'`,
    [host],
  );
  const companyId = rows[0]?.company_id ?? null;
  hostCache.set(host, { companyId, at: Date.now() });
  return companyId;
}

// ── State ──────────────────────────────────────────────────────────────────

async function rowsFor(companyId: number): Promise<{ active: DomainRow | null; pending: DomainRow | null }> {
  const { rows } = await pool.query<DomainRow>(`SELECT * FROM company_domains WHERE company_id = $1`, [companyId]);
  return {
    active: rows.find((r) => r.status === "active") ?? null,
    pending: rows.find((r) => r.status === "pending") ?? null,
  };
}

async function syncCompanyColumns(companyId: number): Promise<void> {
  const { active, pending } = await rowsFor(companyId);
  const cur = active ?? pending;
  await pool.query(
    `UPDATE companies SET custom_domain = $1, custom_domain_status = $2, updated_at = NOW() WHERE id = $3`,
    [cur?.domain ?? null, cur?.status ?? null, companyId],
  );
  clearDomainCache();
}

function present(r: DomainRow | null) {
  if (!r) return null;
  return {
    domain: r.domain,
    status: r.status,
    url: `https://${r.domain}`,
    isRootDomain: isRootDomain(r.domain),
    dnsRecords: (r.dns_records?.length ? r.dns_records : fallbackRecords(r.domain)).map((d) => ({
      type: d.type, name: d.name, value: d.value, current: d.current ?? null, ok: d.ok ?? null,
    })),
    certificateStatus: r.certificate_status,
    lastCheckedAt: r.last_checked_at?.toISOString() ?? null,
    lastError: r.last_error,
    dnsVerifiedAt: r.dns_verified_at?.toISOString() ?? null,
    activatedAt: r.activated_at?.toISOString() ?? null,
  };
}

export async function getDomainState(companyId: number) {
  const { active, pending } = await rowsFor(companyId);
  return {
    active: present(active),
    pending: present(pending),
    automatic: railwayConfigured(),
    targetHost: appPublicHost(),
  };
}

// ── Mutations ──────────────────────────────────────────────────────────────

// Ask Railway to attach the domain and store the DNS records it requires.
// A Railway failure is recorded on the row (shown to the customer) rather
// than thrown — the next "Verify" retries it.
async function attachToRailway(row: DomainRow): Promise<void> {
  if (!railwayConfigured() || row.railway_domain_id) return;
  try {
    const rd = await railwayAddDomain(row.domain);
    await pool.query(
      `UPDATE company_domains SET railway_domain_id = $1, dns_records = $2, certificate_status = $3, last_error = NULL WHERE id = $4`,
      [rd.id, JSON.stringify(rd.records), rd.certificateStatus, row.id],
    );
  } catch (err) {
    logger.error({ err, domain: row.domain }, "Railway domain attach failed");
    await pool.query(
      `UPDATE company_domains SET last_error = $1 WHERE id = $2`,
      ["We couldn't register this domain with our hosting yet — click Verify again in a minute, or contact support.", row.id],
    );
  }
}

export async function requestDomain(companyId: number, rawDomain: unknown) {
  const domain = normalizeDomain(rawDomain);
  const { active, pending } = await rowsFor(companyId);
  if (active?.domain === domain) throw new DomainError("This is already your active domain");
  if (pending?.domain === domain) return getDomainState(companyId);

  const taken = await pool.query(`SELECT company_id FROM company_domains WHERE domain = $1`, [domain]);
  if (taken.rows.length) throw new DomainError("This domain is already connected to another account", 409);

  // Replace any earlier pending request (the customer changed their mind).
  if (pending) {
    await pool.query(`DELETE FROM company_domains WHERE id = $1`, [pending.id]);
    void railwayRemoveDomain(pending.railway_domain_id);
  }
  let inserted: DomainRow;
  try {
    const { rows } = await pool.query<DomainRow>(
      `INSERT INTO company_domains (company_id, domain, status) VALUES ($1, $2, 'pending') RETURNING *`,
      [companyId, domain],
    );
    inserted = rows[0]!;
  } catch (err) {
    // Lost a race with a concurrent request (domain or one-pending-per-company unique index).
    if ((err as { code?: string }).code === "23505") throw new DomainError("This domain was just added — refresh the page", 409);
    throw err;
  }
  await attachToRailway(inserted);
  await syncCompanyColumns(companyId);

  const adminEmail = adminNotifyEmail();
  if (adminEmail) {
    const { rows: c } = await pool.query(`SELECT name FROM companies WHERE id = $1`, [companyId]);
    void sendMail(
      adminEmail,
      `Custom domain requested: ${domain}`,
      `<p><strong>${c[0]?.name ?? "A customer"}</strong> added the custom domain <strong>${domain}</strong>${active ? ` (replacing ${active.domain})` : ""}.</p>
       <p>${railwayConfigured()
        ? "It was attached to Railway automatically and will go live once the customer's DNS verifies."
        : "Railway automation is not configured — add this domain to the Railway service by hand, then mark it Active in Subscriptions → Domain Requests once DNS verifies."}</p>`,
    );
  }
  return getDomainState(companyId);
}

// Promote a pending row to active, retiring the previous active domain.
async function activate(companyId: number, pending: DomainRow, previous: DomainRow | null): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (previous) await client.query(`DELETE FROM company_domains WHERE id = $1`, [previous.id]);
    await client.query(
      `UPDATE company_domains SET status = 'active', activated_at = NOW(), last_error = NULL WHERE id = $1`,
      [pending.id],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  if (previous) void railwayRemoveDomain(previous.railway_domain_id);
  await syncCompanyColumns(companyId);

  const { rows } = await pool.query(`SELECT email FROM companies WHERE id = $1`, [companyId]);
  if (rows[0]?.email) {
    void sendMail(
      rows[0].email,
      "Your custom domain is now live",
      `<p>Good news — <a href="https://${pending.domain}">https://${pending.domain}</a> is now connected to your SHRADHA ERP account.</p>
       ${previous ? `<p>Your previous domain ${previous.domain} has been disconnected.</p>` : ""}
       <p>If the page shows a security warning, wait a few minutes — the HTTPS certificate is still being issued.</p>`,
    );
  }
}

const lastVerify = new Map<number, number>();

// "Check DNS now" from the portal — throttled per company.
export async function verifyDomain(companyId: number) {
  const now = Date.now();
  if (now - (lastVerify.get(companyId) ?? 0) < 5_000) throw new DomainError("Please wait a few seconds before checking again", 429);
  lastVerify.set(companyId, now);

  const { active, pending } = await rowsFor(companyId);
  const row = pending ?? active;
  if (!row) throw new DomainError("Add a domain first", 404);

  await attachToRailway(row);
  return checkDomainNow(companyId);
}

// Re-check DNS for the pending domain (or refresh the active one's status).
// When automatic (Railway configured) and every record matches, the pending
// domain goes live immediately; otherwise staff finish it by hand. Also run
// by lib/domain-scheduler.ts every 15 minutes for pending domains.
export async function checkDomainNow(companyId: number) {
  const { active, pending } = await rowsFor(companyId);
  const target = pending ?? active;
  if (!target) return getDomainState(companyId);

  let records = target.dns_records?.length ? target.dns_records : fallbackRecords(target.domain);
  let certificateStatus = target.certificate_status;
  if (railwayConfigured() && target.railway_domain_id) {
    try {
      const rd = await railwayGetDomain(target.railway_domain_id);
      if (rd.records.length) records = rd.records;
      certificateStatus = rd.certificateStatus;
    } catch {
      /* keep the stored records; our own DNS check below still runs */
    }
  }
  const checked = await Promise.all(records.map(checkRecord));
  const allOk = checked.length > 0 && checked.every((r) => r.ok);
  // A failed Railway attach (set by attachToRailway) outranks the DNS result.
  const lastError = railwayConfigured() && !target.railway_domain_id
    ? target.last_error
    : !checked.length
      ? "Domain setup isn't fully configured on our side yet — our team has been notified."
      : allOk
        ? null
        : "Some DNS records are missing or haven't spread across the internet yet. DNS changes can take from a few minutes up to 24 hours.";

  await pool.query(
    `UPDATE company_domains
       SET dns_records = $1, certificate_status = $2, last_checked_at = NOW(), last_error = $3,
           dns_verified_at = CASE WHEN $4 THEN COALESCE(dns_verified_at, NOW()) ELSE NULL END
     WHERE id = $5`,
    [JSON.stringify(checked), certificateStatus, lastError, allOk, target.id],
  );

  if (target.status === "pending" && allOk) {
    if (railwayConfigured() && target.railway_domain_id) {
      await activate(companyId, target, active);
    } else if (!target.dns_verified_at) {
      const adminEmail = adminNotifyEmail();
      if (adminEmail) {
        void sendMail(
          adminEmail,
          `DNS verified: ${target.domain}`,
          `<p>The DNS for <strong>${target.domain}</strong> is correct. Make sure it's added to the Railway service, then mark it Active in Subscriptions → Domain Requests.</p>`,
        );
      }
    }
  }
  return getDomainState(companyId);
}

export async function removeDomain(companyId: number, which: "pending" | "active") {
  const { active, pending } = await rowsFor(companyId);
  const row = which === "pending" ? pending : active;
  if (!row) throw new DomainError("Nothing to remove", 404);
  await pool.query(`DELETE FROM company_domains WHERE id = $1`, [row.id]);
  void railwayRemoveDomain(row.railway_domain_id);
  await syncCompanyColumns(companyId);
  return getDomainState(companyId);
}

// ── Platform admin ─────────────────────────────────────────────────────────

// One row per company: the pending request if there is one (that's what
// needs attention), otherwise the active domain.
export async function listDomainRequests() {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (d.company_id)
            d.company_id, c.name, c.email, c.mobile, d.domain, d.status,
            GREATEST(d.created_at, d.activated_at, d.last_checked_at) AS updated_at
       FROM company_domains d JOIN companies c ON c.id = d.company_id
      ORDER BY d.company_id, (d.status = 'pending') DESC`,
  );
  return rows
    .map((r) => ({
      companyId: r.company_id,
      companyName: r.name,
      email: r.email ?? null,
      mobile: r.mobile ?? null,
      customDomain: r.domain,
      status: r.status as "pending" | "active",
      updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
    }))
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

// Manual override from the admin console. "active" promotes the company's
// pending domain (staff have attached it in Railway by hand); "pending"
// demotes the active one (e.g. it stopped working).
export async function adminSetDomainStatus(companyId: number, status: "pending" | "active") {
  const { active, pending } = await rowsFor(companyId);
  if (status === "active") {
    if (!pending) throw new DomainError("Company has no pending domain", 404);
    await activate(companyId, pending, active);
  } else {
    if (!active) throw new DomainError("Company has no active domain", 404);
    if (pending) throw new DomainError("Company already has a pending domain — remove it first", 409);
    await pool.query(`UPDATE company_domains SET status = 'pending', activated_at = NULL WHERE id = $1`, [active.id]);
    await syncCompanyColumns(companyId);
  }
  return (await listDomainRequests()).find((r) => r.companyId === companyId)!;
}
