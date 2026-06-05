# ─── Build Stage ──────────────────────────────────────────────────────────────
# node:20-slim is Debian-based — OpenSSL 3 is available, Prisma 5 works out of the box
FROM node:20-slim AS builder

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package*.json ./
RUN npm ci --frozen-lockfile

# Copy source
COPY tsconfig.json ./
COPY prisma ./prisma/
COPY src ./src/

# Generate Prisma client & compile TypeScript
RUN npx prisma generate
RUN npx tsc --project tsconfig.json

# ─── Runtime Stage ────────────────────────────────────────────────────────────
FROM node:20-slim AS runner

WORKDIR /app

# openssl needed by Prisma engine at runtime; curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends openssl curl \
    && rm -rf /var/lib/apt/lists/*

# All dependencies (dev included) so prisma CLI + tsx are available for dev/POC
COPY package*.json ./
RUN npm ci --frozen-lockfile

# Copy source + compiled output + Prisma client
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY prisma ./prisma/
COPY src ./src/

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Run pending Prisma migrations then start the server.
# `prisma migrate deploy` is idempotent — already-applied migrations are skipped.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
