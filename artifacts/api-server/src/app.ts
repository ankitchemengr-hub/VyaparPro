import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import cookieParser from "cookie-parser";
import path from "node:path";
import fs from "node:fs";
import router from "./routes";
import { logger } from "./lib/logger";
import { handleTenantError } from "./lib/tenant";

const SESSION_SECRET = process.env.SESSION_SECRET ?? "shradha-oil-dev-secret";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({ origin: true, credentials: true }));
// 10mb limit to allow base64-encoded product images (~2MB raw → ~2.7MB encoded)
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser(SESSION_SECRET));

// Simple signed-cookie session middleware
app.use((req, _res, next) => {
  const raw = (req as any).signedCookies?.session;
  if (raw) {
    try {
      (req as any).session = JSON.parse(raw);
    } catch {
      (req as any).session = null;
    }
  } else {
    (req as any).session = null;
  }
  next();
});

// Response helper to set session cookie
app.use((_req, res, next) => {
  const origJson = res.json.bind(res);
  (res as any).json = function (body: any) {
    const session = (_req as any).session;
    if (session !== undefined) {
      // Any response that sets or clears the session cookie carries identity
      // state and must never be cached, or a stale authenticated body can be
      // replayed from the browser/proxy cache after the cookie is cleared.
      res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.set("Pragma", "no-cache");
      res.set("Expires", "0");
      if (session === null) {
        res.clearCookie("session", { path: "/" });
      } else {
        res.cookie("session", JSON.stringify(session), {
          signed: true,
          httpOnly: true,
          sameSite: "lax",
          path: "/",
          maxAge: 8 * 60 * 60 * 1000, // 8h
        });
      }
    }
    return origJson(body);
  };
  next();
});

app.use("/api", router);

// Unmatched /api/* routes return a JSON 404 (never the SPA / HTML). This keeps
// the API surface JSON-only and makes a missing endpoint obvious to clients.
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// ---------------------------------------------------------------------------
// Production single-container serving (Docker / Coolify / Hostinger VPS)
// ---------------------------------------------------------------------------
// In these deploys the API server is the only process, so it must also serve
// the built frontend SPA. This is mounted AFTER the `/api` router so API routes
// are never shadowed by the catch-all, and the catch-all explicitly excludes
// `/api/*` so unknown API paths return JSON 404 (not index.html).
//
// On Replit the frontend is served by a separate static service, so the build
// output is not present next to this server — the `existsSync` guard keeps this
// inactive there (and in local dev, where Vite serves the frontend).
const STATIC_DIR = process.env.FRONTEND_DIST
  ? path.resolve(process.env.FRONTEND_DIST)
  : path.resolve(__dirname, "../../erp/dist/public");
const INDEX_HTML = path.join(STATIC_DIR, "index.html");

if (fs.existsSync(INDEX_HTML)) {
  logger.info({ staticDir: STATIC_DIR }, "Serving frontend SPA from API server");
  app.use(express.static(STATIC_DIR));
  // SPA history fallback — GET non-/api routes return index.html.
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) {
      next();
      return;
    }
    res.sendFile(INDEX_HTML);
  });
} else {
  logger.info(
    { staticDir: STATIC_DIR },
    "Frontend build not found next to API server; serving API only",
  );
}

// Central error handler. Async route handlers in Express 5 forward thrown
// errors here, so company-scoped routes can simply call getCompanyId(req) and
// let a missing tenant context surface as a 401/403 instead of a 500.
app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (handleTenantError(err, res)) return;
  logger.error({ err }, "Unhandled route error");
  res.status(500).json({ error: "Internal server error" });
});

export default app;
