// Usernames must be unique across ALL companies for new accounts. The schema
// only enforces (company_id, username), but login has no company picker for
// regular staff, so two companies each having an "accountant" makes the
// login ambiguous. Older duplicates still log in (login tells them apart by
// password); this just stops new ones from being created.

type Queryable = { query: (text: string, params?: any[]) => Promise<{ rows: any[] }> };

export async function isUsernameTaken(q: Queryable, username: string): Promise<boolean> {
  const { rows } = await q.query(
    `SELECT 1 FROM users WHERE lower(trim(username)) = lower(trim($1)) LIMIT 1`,
    [username],
  );
  return rows.length > 0;
}

function slug(s: string | null | undefined): string {
  const first = (s ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]/g, "").trim().split(/\s+/)[0] ?? "";
  return first.slice(0, 10);
}

// A free variant to offer the admin: "accountant_shradha", then "accountant2"…
export async function suggestUsername(q: Queryable, base: string, companyName?: string | null): Promise<string | null> {
  const clean = base.trim().toLowerCase().replace(/\s+/g, "");
  const company = slug(companyName);
  const candidates = [
    ...(company && !clean.endsWith(company) ? [`${clean}_${company}`] : []),
    ...Array.from({ length: 20 }, (_, i) => `${clean}${i + 2}`),
  ];
  for (const c of candidates) {
    if (!(await isUsernameTaken(q, c))) return c;
  }
  return null;
}

export function usernameTakenMessage(username: string, suggestion: string | null): string {
  return suggestion
    ? `Username "${username}" is already in use. Please choose another, e.g. "${suggestion}".`
    : `Username "${username}" is already in use. Please choose another.`;
}
