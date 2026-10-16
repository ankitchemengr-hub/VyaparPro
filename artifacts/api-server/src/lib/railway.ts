// Thin client for Railway's public GraphQL API — used to attach/detach a
// customer's custom domain to THIS service, so Railway routes it here and
// issues the HTTPS certificate automatically.
//
// Required env (set in the Railway service's Variables tab), ONE of:
//   RAILWAY_PROJECT_TOKEN   — Project token (Project Settings → Tokens), scoped
//                             to this project + environment. Preferred.
//   RAILWAY_API_TOKEN       — Account/Team token (Account Settings → Tokens)
// Provided automatically by Railway inside every deployment (override if needed):
//   RAILWAY_PROJECT_ID, RAILWAY_ENVIRONMENT_ID, RAILWAY_SERVICE_ID
//
// When any of these is missing, railwayConfigured() is false and the domain
// flow falls back to "customer adds a CNAME, staff attach it in Railway by
// hand and click Mark as Active" — nothing breaks, it's just manual.
import { logger } from "./logger";

const RAILWAY_API = "https://backboard.railway.com/graphql/v2";

export interface DnsRecord {
  type: string; // CNAME | TXT | A | ...
  name: string; // host label shown to the customer ("@" for the root)
  fqdn: string; // full name used for our own DNS lookup
  value: string; // what the record must point to / contain
  current?: string | null; // what DNS currently returns, when known
  ok?: boolean | null; // null = not checked yet
}

export interface RailwayDomain {
  id: string;
  records: DnsRecord[];
  certificateStatus: string | null;
}

function cfg() {
  const projectToken = process.env["RAILWAY_PROJECT_TOKEN"];
  return {
    token: projectToken || process.env["RAILWAY_API_TOKEN"],
    // Railway expects project tokens in their own header, account/team
    // tokens as a Bearer token.
    authHeader: (projectToken
      ? { "Project-Access-Token": projectToken }
      : { Authorization: `Bearer ${process.env["RAILWAY_API_TOKEN"]}` }) as Record<string, string>,
    projectId: process.env["RAILWAY_PROJECT_ID"],
    environmentId: process.env["RAILWAY_ENVIRONMENT_ID"],
    serviceId: process.env["RAILWAY_SERVICE_ID"],
  };
}

export function railwayConfigured(): boolean {
  const c = cfg();
  return !!(c.token && c.projectId && c.environmentId && c.serviceId);
}

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(RAILWAY_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...cfg().authHeader },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await res.json().catch(() => null)) as { data?: T; errors?: Array<{ message: string }> } | null;
  if (!res.ok || !body || body.errors?.length) {
    const msg = body?.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`;
    logger.error({ status: res.status, msg }, "Railway API call failed");
    throw new Error(`Railway: ${msg}`);
  }
  return body.data as T;
}

const DOMAIN_FIELDS = `
  id
  domain
  status {
    certificateStatus
    dnsRecords { hostlabel fqdn recordType requiredValue currentValue status }
  }
`;

interface RawDomain {
  id: string;
  domain: string;
  status?: {
    certificateStatus?: string | null;
    dnsRecords?: Array<{
      hostlabel?: string | null; fqdn?: string | null; recordType?: string | null;
      requiredValue?: string | null; currentValue?: string | null; status?: string | null;
    }> | null;
  } | null;
}

function mapDomain(d: RawDomain): RailwayDomain {
  const records = (d.status?.dnsRecords ?? []).map((r) => ({
    // Railway reports e.g. "DNS_RECORD_TYPE_CNAME" — show just "CNAME".
    type: (r.recordType ?? "CNAME").replace(/^DNS_RECORD_TYPE_/, ""),
    name: r.hostlabel || "@",
    fqdn: r.fqdn || d.domain,
    value: r.requiredValue ?? "",
    current: r.currentValue || null,
    ok: r.status ? /PROPAGATED/i.test(r.status) : null,
  }));
  return { id: d.id, records, certificateStatus: d.status?.certificateStatus ?? null };
}

export async function railwayAddDomain(domain: string): Promise<RailwayDomain> {
  const c = cfg();
  const data = await gql<{ customDomainCreate: RawDomain }>(
    `mutation($input: CustomDomainCreateInput!) { customDomainCreate(input: $input) { ${DOMAIN_FIELDS} } }`,
    { input: { domain, projectId: c.projectId, environmentId: c.environmentId, serviceId: c.serviceId } },
  );
  return mapDomain(data.customDomainCreate);
}

export async function railwayGetDomain(id: string): Promise<RailwayDomain> {
  const data = await gql<{ customDomain: RawDomain }>(
    `query($id: String!, $projectId: String!) { customDomain(id: $id, projectId: $projectId) { ${DOMAIN_FIELDS} } }`,
    { id, projectId: cfg().projectId },
  );
  return mapDomain(data.customDomain);
}

// Best-effort: a failure here only leaves a stale entry in Railway, which
// staff can delete by hand — never block the customer's change on it.
export async function railwayRemoveDomain(id: string | null | undefined): Promise<void> {
  if (!id || !railwayConfigured()) return;
  try {
    await gql(`mutation($id: String!) { customDomainDelete(id: $id) }`, { id });
  } catch (err) {
    logger.warn({ err, id }, "Could not remove domain from Railway (remove it manually)");
  }
}
