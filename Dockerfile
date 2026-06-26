FROM node:22-alpine
RUN npm install -g pnpm@11.9.0
WORKDIR /app
COPY . .
RUN pnpm install --no-frozen-lockfile
WORKDIR /app/artifacts/api-server
RUN pnpm run build
CMD ["pnpm", "start"]