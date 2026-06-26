// PM2 process manager config for Vipro ERP (local Windows setup).
//
// Usage (from the project root, C:\Users\Ankit\Desktop\Auth-Fixer):
//   pm2 start ecosystem.config.cjs     -> start both apps
//   pm2 status                         -> see if they're running
//   pm2 logs                           -> see live logs from both
//   pm2 logs vipro-api                 -> see logs from just the backend
//   pm2 restart all                    -> restart both
//   pm2 stop all                       -> stop both
//   pm2 save                           -> remember this state for auto-start on boot
//
module.exports = {
  apps: [
    {
      name: "vipro-api",
      cwd: "./artifacts/api-server",
      script: "node",
      args: "--env-file=../../.env --enable-source-maps ./dist/index.mjs",
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
    },
    {
      name: "vipro-frontend",
      cwd: "./artifacts/frontend",
      script: "node",
      args: "./node_modules/vite/bin/vite.js --config vite.config.ts --host 0.0.0.0",
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      env: {
        VITE_API_PROXY_TARGET: "http://localhost:3001",
      },
    },
  ],
};