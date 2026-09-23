import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// The public SHRADHA ERP marketing site + customer portal — a separate app
// from artifacts/frontend (the ERP itself) so the two live on genuinely
// different links/ports locally (and different domains once deployed),
// per the architecture the user asked for. Talks to the SAME backend
// (artifacts/api-server) via the /api proxy below, so the session cookie
// set by either app's login is usable by the other (cookies aren't
// port-scoped on localhost, and won't be domain-scoped in prod either once
// ERP_APPLICATION_URL points across to the ERP's own domain).
const rawPort = process.env.PORT ?? "3002";
const port = Number(rawPort);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY_TARGET ?? "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
