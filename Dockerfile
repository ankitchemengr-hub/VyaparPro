FROM node:22-alpine
RUN npm install -g pnpm@11.9.0
WORKDIR /app
COPY . .
RUN pnpm install --no-frozen-lockfile
# The ERP frontend is served by the API server itself (same origin), so a
# customer's custom domain pointed at this service opens the ERP and its /api.
RUN pnpm --filter @workspace/frontend run build
ENV FRONTEND_DIST=/app/artifacts/frontend/dist/public
WORKDIR /app/artifacts/api-server
RUN pnpm run build
CMD ["pnpm", "start"]
