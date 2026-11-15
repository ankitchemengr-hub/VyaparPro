// Manufacturing → Assemble Item → Assembly History: list by date with liters,
// filters, admin edit (batches / qty / date / worker) and delete, keeping raw
// material stock and Ready Material in step. Needs TEST_DATABASE_URL.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DB = process.env.TEST_DATABASE_URL;
if (!TEST_DB) throw new Error("Set TEST_DATABASE_URL to a throwaway database");
process.env.DATABASE_URL = TEST_DB;
process.env.SESSION_SECRET = "assembly-history-test-secret";
delete process.env.DEFAULT_COMPANY_ID;
process.env.MULTI_COMPANY_MODE = "true";
process.env.FRONTEND_DIST = "./__no_frontend__";
(globalThis as any).require ??= createRequire(import.meta.url);
(globalThis as any).__dirname ??= path.dirname(fileURLToPath(import.meta.url));

let pool: any;
let server: Server;
let base = "";
const RUN = Math.floor(Math.random() * 90000);
const A = 600000 + RUN;
const cookies: Record<string, string> = {};
const ids: Record<string, number> = {};

function sign(session: object): string {
  const val = JSON.stringify(session);
  const sig = createHmac("sha256", process.env.SESSION_SECRET!).update(val).digest("base64").replace(/=+$/, "");
  return `session=${encodeURIComponent(`s:${val}.${sig}`)}`;
}
async function call(who: string, method: string, p: string, body?: unknown) {
  const res = await fetch(base + "/api" + p, {
    method,
    headers: { cookie: cookies[who], ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const stock = async (id: number) => Number((await pool.query(`SELECT current_stock FROM products WHERE id = $1`, [id])).rows[0].current_stock);
const ready = async () => Number((await pool.query(
  `SELECT COALESCE(SUM(qty), 0) AS q FROM ready_material_batches WHERE company_id = $1 AND product_id = $2 AND status = 'ready'`, [A, ids.oil],
)).rows[0].q);
const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const istDaysAgo = (n: number) => new Date(Date.now() + 5.5 * 3600 * 1000 - n * 86400 * 1000).toISOString().slice(0, 10);

before(async () => {
  const { ensureDatabaseReady } = await import("../src/lib/bootstrap");
  await ensureDatabaseReady();
  ({ pool } = await import("@workspace/db"));
  const app = (await import("../src/app")).default;
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  await pool.query(`INSERT INTO companies (id, name) VALUES ($1, $2)`, [A, `Assembly ${RUN}`]);
  for (const role of ["admin", "manufacturing", "salesman"]) {
    const u = await pool.query(
      `INSERT INTO users (username, password_hash, name, role, company_id, is_active) VALUES ($1, 'x', $2, $3, $4, true) RETURNING id`,
      [`${role}-asm-${RUN}`, role, role, A],
    );
    cookies[role] = sign({ userId: u.rows[0].id, username: `${role}-asm-${RUN}`, role, name: role, entityId: null, companyId: A });
  }
  const prod = async (name: string, code: string, extra = "") => (await pool.query(
    `INSERT INTO products (company_id, name, "group", brand, item_code, unit, current_stock${extra ? ", liters_per_box, add_for_manufacturing" : ""})
     VALUES ($1, $2, 'G', 'B', $3, 'PCS', 0${extra ? ", 2, true" : ""}) RETURNING id`,
    [A, name, `${code}-${RUN}`],
  )).rows[0].id;
  ids.base = await prod("Base Oil", "BASE");
  ids.can = await prod("Empty Can", "CAN");
  ids.oil = await prod("Engine Oil 2L", "OIL", "x");
  ids.bom = (await pool.query(`INSERT INTO boms (company_id, finished_product_id, output_quantity) VALUES ($1, $2, 10) RETURNING id`, [A, ids.oil])).rows[0].id;
  await pool.query(
    `INSERT INTO bom_items (company_id, bom_id, material_product_id, quantity, unit) VALUES ($1, $2, $3, 2, 'L'), ($1, $2, $4, 1, 'PCS')`,
    [A, ids.bom, ids.base, ids.can],
  );
  ids.ramu = (await pool.query(`INSERT INTO workers (company_id, name) VALUES ($1, 'Ramu') RETURNING id`, [A])).rows[0].id;
  ids.shyam = (await pool.query(`INSERT INTO workers (company_id, name) VALUES ($1, 'Shyam') RETURNING id`, [A])).rows[0].id;
});

after(async () => {
  server?.close();
  await pool?.end();
});

test("an assemble run shows in history with liters, batches and worker", async () => {
  const r = await call("manufacturing", "POST", "/manufacturing/assemble", { bomId: ids.bom, batches: 3, workerId: ids.ramu });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(await stock(ids.base), -6);
  assert.equal(await stock(ids.can), -3);
  assert.equal(await ready(), 30);

  const list = await call("manufacturing", "GET", `/manufacturing/assemblies?from=${istToday()}&to=${istToday()}`);
  assert.equal(list.status, 200);
  assert.equal(list.body.length, 1);
  const run = list.body[0];
  ids.run = run.id;
  assert.equal(run.qty, 30);
  assert.equal(run.liters, 60, "30 cans × 2 L");
  assert.equal(run.batches, 3);
  assert.equal(run.workerName, "Ramu");
  assert.equal(run.date, istToday());

  assert.equal((await call("salesman", "GET", "/manufacturing/assemblies")).status, 403);
  assert.equal((await call("manufacturing", "PATCH", `/manufacturing/assemblies/${run.id}`, { batches: 5 })).status, 403, "edit is admin only");
});

test("admin edit: batches scale materials and Ready Material; date and worker change", async () => {
  const r = await call("admin", "PATCH", `/manufacturing/assemblies/${ids.run}`, { batches: 5, workerId: ids.shyam });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.qty, 50);
  assert.equal(r.body.batches, 5);
  assert.equal(r.body.workerName, "Shyam");
  assert.equal(await stock(ids.base), -10);
  assert.equal(await stock(ids.can), -5);
  assert.equal(await ready(), 50);

  // Back down to 2 batches gives material back.
  await call("admin", "PATCH", `/manufacturing/assemblies/${ids.run}`, { batches: 2 });
  assert.equal(await stock(ids.base), -4);
  assert.equal(await stock(ids.can), -2);
  assert.equal(await ready(), 20);

  const y = istDaysAgo(1);
  const d = await call("admin", "PATCH", `/manufacturing/assemblies/${ids.run}`, { date: y });
  assert.equal(d.body.date, y);
  const todayList = await call("admin", "GET", `/manufacturing/assemblies?from=${istToday()}&to=${istToday()}`);
  assert.equal(todayList.body.length, 0, "moved to yesterday");
  const byWorker = await call("admin", "GET", `/manufacturing/assemblies?from=${y}&to=${istToday()}&workerId=${ids.shyam}`);
  assert.equal(byWorker.body.length, 1);
  const other = await call("admin", "GET", `/manufacturing/assemblies?from=${y}&to=${istToday()}&workerId=${ids.ramu}`);
  assert.equal(other.body.length, 0);
  assert.equal((await call("admin", "PATCH", `/manufacturing/assemblies/${ids.run}`, { batches: 0 })).status, 400);
});

test("older runs without a batch count edit by quantity; auto-manufacture runs are not listed", async () => {
  const card = (await pool.query(
    `INSERT INTO workload_cards (company_id, product_id, target_qty, status, order_type, started_at, completed_at)
     VALUES ($1, $2, 10, 'done', 'production', NOW(), NOW()) RETURNING id`, [A, ids.oil],
  )).rows[0].id;
  await pool.query(
    `INSERT INTO stock_movements (company_id, product_id, type, quantity, reason, reference_id, reference_type, user_id)
     VALUES ($1, $2, 'manufacturing_consume', 4, 'Manufacturing batch', $3, 'workload', 0)`, [A, ids.base, card],
  );
  await pool.query(`UPDATE products SET current_stock = current_stock - 4 WHERE id = $1`, [ids.base]);
  await pool.query(
    `INSERT INTO workload_cards (company_id, product_id, target_qty, status, order_type, worker_name, started_at, completed_at)
     VALUES ($1, $2, 7, 'done', 'production', 'Auto — invoice', NOW(), NOW())`, [A, ids.oil],
  );
  const list = await call("admin", "GET", `/manufacturing/assemblies?from=${istToday()}&to=${istToday()}`);
  assert.deepEqual(list.body.map((r: any) => r.id), [card], "the Auto run is left out");
  assert.equal(list.body[0].batches, null);

  assert.equal((await call("admin", "PATCH", `/manufacturing/assemblies/${card}`, { batches: 2 })).status, 400);
  const baseBefore = await stock(ids.base);
  const readyBefore = await ready();
  const r = await call("admin", "PATCH", `/manufacturing/assemblies/${card}`, { qty: 15 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(await stock(ids.base), baseBefore - 2, "4 → 6 base oil for 10 → 15");
  assert.equal(await ready(), readyBefore + 5);
});

test("delete gives materials back and takes the output off Ready Material", async () => {
  const baseBefore = await stock(ids.base);
  const canBefore = await stock(ids.can);
  const readyBefore = await ready();
  assert.equal((await call("manufacturing", "DELETE", `/manufacturing/assemblies/${ids.run}`)).status, 403);
  const r = await call("admin", "DELETE", `/manufacturing/assemblies/${ids.run}`);
  assert.equal(r.status, 204);
  assert.equal(await stock(ids.base), baseBefore + 4, "2 batches × 2 L back");
  assert.equal(await stock(ids.can), canBefore + 2);
  assert.equal(await ready(), readyBefore - 20);
  const all = await call("admin", "GET", `/manufacturing/assemblies?from=${istDaysAgo(3)}&to=${istToday()}`);
  assert.ok(!all.body.some((x: any) => x.id === ids.run));
  assert.equal((await call("admin", "DELETE", `/manufacturing/assemblies/${ids.run}`)).status, 404);
});
