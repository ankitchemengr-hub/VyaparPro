// Runs the api-server tests with node:test, loading TypeScript through tsx.
// tsx is resolved from the pnpm store so no extra install is needed.
//
//   TEST_DATABASE_URL=postgres://postgres@localhost:55432/erp_cleanup_test node test/run.mjs
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..", "..");

function findTsx() {
  const direct = path.join(root, "node_modules", "tsx", "dist", "esm", "index.mjs");
  if (existsSync(direct)) return direct;
  const store = path.join(root, "node_modules", ".pnpm");
  const dir = existsSync(store) ? readdirSync(store).filter((d) => d.startsWith("tsx@")).sort().pop() : null;
  const viaStore = dir && path.join(store, dir, "node_modules", "tsx", "dist", "esm", "index.mjs");
  if (viaStore && existsSync(viaStore)) return viaStore;
  throw new Error("tsx not found — install it or run pnpm install");
}

if (!process.env.TEST_DATABASE_URL) {
  console.error("Set TEST_DATABASE_URL to a throwaway database (never a real one).");
  process.exit(1);
}

const files = readdirSync(here).filter((f) => f.endsWith(".test.ts")).map((f) => path.join(here, f));
const r = spawnSync(
  process.execPath,
  ["--import", pathToFileURL(findTsx()).href, "--test", "--test-concurrency=1", ...files],
  { stdio: "inherit", cwd: path.resolve(here, "..") },
);
process.exit(r.status ?? 1);
