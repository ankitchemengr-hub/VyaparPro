// Finding a product by what the user types or scans: name, item code, part
// number or barcode. Used by billing and purchase item pickers so a scanned
// barcode or a typed part no. lands on the right product.

type Matchable = { name: string; itemCode?: string | null; partNo?: string | null; barcode?: string | null };

// 0 = exact barcode / part no. / item code (a scan), 1 = name starts with it,
// 2 = name, code or part no. contains it, -1 = no match.
export function productMatchRank(p: Matchable, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 2;
  const code = (p.itemCode ?? "").toLowerCase();
  const part = (p.partNo ?? "").toLowerCase();
  const bar = (p.barcode ?? "").toLowerCase();
  if (q === bar || q === part || q === code) return 0;
  const name = p.name.toLowerCase();
  if (name.startsWith(q)) return 1;
  if (name.includes(q) || code.includes(q) || part.includes(q)) return 2;
  return -1;
}

// Products matching the query, best matches first (an exact scan on top).
export function matchProducts<T extends Matchable>(products: T[], query: string): T[] {
  if (!query.trim()) return products;
  return products
    .map((p, i) => ({ p, i, r: productMatchRank(p, query) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.p);
}
