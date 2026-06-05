# RevSecureCloud — Technical & Functional Specification (POC)

Version: 1.1.0
Date: 2026-02-28

## Purpose

This document describes the current technical architecture and functional behaviour of the RevSecureCloud backend (POC). It is intended for developers and technical stakeholders who need to understand how the system is organised, how to run it locally and in production, and the main API behaviours.

## Overview

- Application: Node.js + TypeScript backend using Fastify.
- Primary responsibilities:
  - Authenticate users (email/password, GitHub)
  - Manage companies, users, billing metadata
  - Ingest and analyse revenue records and detect revenue leakages
  - Expose REST API with OpenAPI docs (dev only)

## Tech Stack

- Runtime: Node.js (>=20)
- Language: TypeScript
- Web framework: Fastify
- ORM: Prisma (PostgreSQL)
- Queue: BullMQ (Redis) — optional (enabled via `REDIS_ENABLED`)
- Docs: @fastify/swagger + @fastify/swagger-ui (registered only when NODE_ENV !== 'production')
- Auth: JWT (`@fastify/jwt`) and OAuth via GitHub (optional)
- Task runner: scripts are provided for dev, migrations, seeding, and PDF generation

## High-level Architecture

- HTTP API (Fastify)
- Database (Postgres) managed via Prisma
- Optional Redis for background workers and rate limiting
- Background workers: BullMQ workers (revenue analysis, notifications)

## Important Files & Locations

- `src/app.ts` — Fastify application setup (plugins, routes, CORS, security, swagger, health).
- `src/server.ts` — Server bootstrap and graceful shutdown.
- `src/config/env.ts` — Environment variables schema and defaults (Zod).
- `src/modules/audit/audit.service.ts` — `createAuditLog` (write) and `listAuditLogs` (paginated read) functions.
- `src/modules/audit/audit.routes.ts` — `GET /api/v1/audit` route handler (JWT + COMPANY_ADMIN guard).
- `src/infrastructure/demo/DemoDataService.ts` — demo tenant generator (local/staging only).
- `src/infrastructure/data-migrations/` — idempotent data-migration scripts (run via `npm run db:migrate:data`).
- `prisma/schema.prisma` — Prisma schema; migrations live in `prisma/migrations/`.
- `prisma/seed.ts` — Database seed script used for POC demo data.
- `.github/workflows/prisma-migrate-deploy.yml` — CI workflow to apply migrations to production.
- `scripts/run-prod-migrations.js` — helper to safely run migrations against production.
- `scripts/run-prod-seed.js` — helper to safely seed production (POC only).
- `docs/` — documentation and generated PDFs.

## Environment Variables (key)

Required for runtime (see `src/config/env.ts` for full list and validation):

- `DATABASE_URL` — Prisma connection string (Postgres), required.
- `JWT_SECRET` / `JWT_REFRESH_SECRET` — JWT signing secrets (min 32 chars).
- `APP_URL` — Base URL for the app (used in OpenAPI servers and CORS defaults).
- `API_PREFIX` — default `/api/v1`.
- `PORT`, `HOST` — server listen settings.
- `REDIS_ENABLED`, `REDIS_URL` — enable/disable Redis and provide connection.

Example local `.env` values are provided in `.env.example`.

## API Endpoints — Summary

Base prefix: `/api/v1` (see `API_PREFIX`). Major groups:

- `POST /api/v1/auth/login` — email/password login (returns JWT tokens).
- `POST /api/v1/auth/refresh` — refresh token endpoint.
- `GET /api/v1/health` — health check (database and optional Redis)
- `GET /` — root info (returns docs path)
- `*/users`, `*/company`, `*/revenue`, `*/billing`, `*/integrations` — resource groups implemented in `modules/`.
- `GET /api/v1/audit` — paginated audit trail for the caller's company. Requires `COMPANY_ADMIN` or `SUPER_ADMIN` role. Supports query params: `page`, `limit`, `search`, `action`.

For full API reference see the OpenAPI docs (dev): `/docs` when `NODE_ENV !== 'production'`.

## Security Considerations

- CORS is configured in `src/app.ts` with explicit allowed origins; credentials are supported.
- Rate limiting is enabled globally via `@fastify/rate-limit`.
- Helmet is enabled for security headers.
- JWT secrets must be kept secret in production; rotate regularly.

## Database Migrations & Seeding

- Migrations are stored in `prisma/migrations/` and applied in production using `npx prisma migrate deploy`.
- For POC we ran the seed script `prisma/seed.ts` to create demo company, users and sample revenue data.
- Workflow `.github/workflows/prisma-migrate-deploy.yml` applies migrations and can optionally run the seed with a `seed` input (use with caution).

## Running Locally (developer quick start)

1. Install dependencies:
   ```bash
   npm ci
   ```
2. Start local Postgres (docker-compose provided) and set `.env` (see `.env.example`).
3. Run migrations locally and generate client:
   ```bash
   npx prisma migrate dev --name init
   npx prisma generate
   ```
4. Seed local DB (optional):
   ```bash
   npm run db:seed
   ```
5. Start dev server with HMR:
   ```bash
   npm run dev
   ```
6. Local URLs:
   - API: `http://localhost:3000/api/v1`
   - Swagger (dev): `http://localhost:3000/docs`
   - Health: `http://localhost:3000/health`

## Deploying & CI

- Add `PROD_DATABASE_URL` to GitHub Secrets.
- Trigger `.github/workflows/prisma-migrate-deploy.yml` via Actions UI or `gh` CLI.
- The workflow runs `npx prisma migrate deploy` and `npx prisma generate`.

## Functional Requirements (POC)

- Authenticate users and return JWT tokens.
- Manage companies and users with RBAC (roles: COMPANY_ADMIN, ANALYST, etc.).
- Ingest revenue records and compute simple MRR/ARR metrics for demonstration.
- Detect and persist sample 'revenue leakages' for analysis.
- Provide API endpoints for the frontend to list companies, revenues, leakages and perform analysis.

## Sample User Flows

1. Admin login:
   - POST `/api/v1/auth/login` with `{email,password}`
   - Receive `accessToken` and `refreshToken`.
   - A `LOGIN` audit event is written automatically.
2. Fetch revenues:
   - GET `/api/v1/revenue?companyId=...`
3. Create a revenue record (for POC):
   - POST `/api/v1/revenue` with payload (amount, currency, period, product)
4. View audit trail (COMPANY_ADMIN only):
   - GET `/api/v1/audit` with `Authorization: Bearer <accessToken>`
   - Optional filters: `?page=1&limit=20&search=admin&action=LOGIN`
   - Returns `{ data: [{ id, actorEmail, actorName, action, resourceType, detail, createdAt, … }], meta: { total, page, … } }`

## Observability & Logging

- Pino logger configured in `src/app.ts` using `pino-pretty` in development.
- Basic health check endpoint exists. Add more metrics and alerting in production.

## Known Limitations (POC)

- Seed data is present in production for POC — remove or rotate before public launch.
- Swagger UI is disabled in production by default.
- Migrations are linear and require careful review before production deployment.
- Audit log `userAgent` is not captured yet (always `null`); add it via request header in a future iteration.

## Next recommended steps

- Harden secrets: rotate JWT secrets and remove demo credentials.
- Add monitoring (Prometheus, Sentry) and production logging sink.
- Create a staging environment where Swagger and seeding are safe.
- Run CI migration workflow against production to apply `20260228172119_add_audit_log_actor_fields`.
- Run `npm run db:migrate:data` on production to backfill actor fields on existing audit log rows.
- Add `userAgent` capture to `createAuditLog` calls in route handlers.

---

Contact: development team
