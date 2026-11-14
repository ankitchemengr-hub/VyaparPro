import type { Request, Response, NextFunction } from "express";
import { requestHost } from "./custom-domains";

// Which browser origins may call the API with the session cookie. Same-origin
// pages (the app itself, a company's own custom domain) always may; so may the
// platform's own domains and local development. Extra origins can be listed
// in CORS_ORIGINS (comma separated, e.g. "https://partner.example.com").

const PLATFORM_HOST_RE = /^([a-z0-9-]+\.)*shradhaerp\.com$/;
const LOCAL_HOST_RE = /^(localhost|127\.0\.0\.1|\[::1\])$/;

function extraOrigins(): string[] {
  return (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase().replace(/\/$/, ""))
    .filter(Boolean);
}

function hostOnly(h: string | undefined): string | undefined {
  return h?.toLowerCase().replace(/:\d+$/, "");
}

export function originAllowed(origin: string, req: Request): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false; // includes the literal "null" origin
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = url.hostname.toLowerCase();
  if (host === hostOnly(requestHost(req as any)) || host === hostOnly(req.headers.host)) return true;
  if (url.protocol === "https:" && PLATFORM_HOST_RE.test(host)) return true;
  if (LOCAL_HOST_RE.test(host)) return true;
  return extraOrigins().includes(origin.toLowerCase().replace(/\/$/, ""));
}

// cors() origin callback: reflect only allowed origins (never "any site").
export function corsOrigin(req: Request, cb: (err: Error | null, options?: { origin: boolean; credentials: boolean }) => void): void {
  const origin = req.headers.origin;
  cb(null, { origin: !origin || originAllowed(origin, req), credentials: true });
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// A page on another site can still SEND a form/fetch to the API even when CORS
// stops it reading the answer. Refuse any data-changing request whose Origin
// is a foreign site. Server-to-server calls (payment webhooks) send no Origin.
export function blockForeignWrites(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  if (!SAFE_METHODS.has(req.method) && origin && !originAllowed(origin, req)) {
    res.status(403).json({ error: "Request from another website refused." });
    return;
  }
  next();
}

// Baseline security headers on every response.
export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Content-Security-Policy", "frame-ancestors 'self'");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=()");
  const proto = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim();
  if (req.secure || proto === "https") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000");
  }
  next();
}

// For user-uploaded files served back from our own origin: the browser must
// treat them as the declared type only and never run script inside them.
// PDFs skip the sandbox: Chrome's PDF viewer refuses to render in one (the
// Purchases preview shows PDFs in an iframe), and uploads only accept PDF,
// JPG and PNG anyway.
export function setUploadedFileHeaders(res: Response, mimeType: string): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (mimeType !== "application/pdf") {
    res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
  }
}
