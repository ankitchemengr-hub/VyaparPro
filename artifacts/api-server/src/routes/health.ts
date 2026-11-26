import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { tlsAllowed } from "../lib/custom-domains";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// Caddy (on-demand TLS) asks here before issuing a certificate for a host:
// 200 = one of our companies' domains, 404 = refuse.
router.get("/internal/tls-ask", async (req, res) => {
  try {
    res.status((await tlsAllowed(req.query["domain"])) ? 200 : 404).end();
  } catch {
    res.status(503).end();
  }
});

export default router;
