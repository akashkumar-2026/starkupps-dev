# syntax=docker/dockerfile:1

# ── Stage 1: build ─────────────────────────────────────────────────────────
# Dev dependencies (vite, esbuild) are needed here and must NOT reach the
# runtime image — Cloud Run only needs what dist/index.js actually imports.
FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts index.html components.json ./
COPY public ./public
COPY shared ./shared
COPY server ./server
COPY src ./src
COPY dev ./dev

# Produces dist/index.js (server bundle) and dist/public (client bundle).
RUN npm run build

# ── Stage 2: runtime ──────────────────────────────────────────────────────
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# argon2 ships a prebuilt linux-x64 binding, so no build toolchain is needed.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Run unprivileged. Cloud Run sets PORT; server/index.ts already reads it.
USER node
EXPOSE 8080

# Matches the health route in server/index.ts:527.
CMD ["node", "dist/index.js"]