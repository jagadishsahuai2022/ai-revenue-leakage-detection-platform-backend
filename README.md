# revsecurecloudbackend

**RevSecureCloud** — Revenue Leakage Detector · Backend API

Built with **Fastify 4 + TypeScript + Prisma + PostgreSQL + Redis + BullMQ**.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20, TypeScript 5.6 |
| Framework | Fastify 4.28 |
| ORM | Prisma 5.22 |
| Database | PostgreSQL 16 |
| Cache / Queue | Redis 7 + BullMQ 5 |
| Auth | JWT (access + refresh) + GitHub OAuth |
| Payments | Stripe SDK 16 |
| Validation | Zod |
| Logging | Pino |
| API Docs | Swagger / Scalar UI at `/docs` |

---

## Quick Start (Docker)

```bash
cp .env.example .env
# Edit .env — set DATABASE_URL, REDIS_URL, JWT secrets, Stripe keys, GitHub OAuth

docker compose up -d
```

API available at `http://localhost:3000`  
Swagger UI at `http://localhost:3000/docs`  
Health check: `http://localhost:3000/health`

---

## Local Dev (no Docker)

```bash
npm install
npm run db:push      # push Prisma schema
npm run db:seed      # seed demo data
npm run dev          # ts-node-dev watch mode
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `JWT_SECRET` | Access token secret (≥32 chars) |
| `JWT_REFRESH_SECRET` | Refresh token secret (≥32 chars) |
| `STRIPE_SECRET_KEY` | Stripe API key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `GITHUB_CLIENT_ID` | GitHub OAuth app client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth app client secret |
| `GITHUB_CALLBACK_URL` | `https://revsecurecloud.com/api/v1/auth/github/callback` |

---

## Project Structure

```
src/
  server.ts          ← Fastify bootstrap
  plugins/           ← JWT, Swagger, sensible
  routes/
    auth/            ← Login, register, GitHub OAuth, refresh
    users/           ← User CRUD
    companies/       ← Tenant management
    revenue/         ← Revenue records + analytics
    leakages/        ← Leakage detection + status
    billing/         ← Stripe subscriptions + webhooks
    integrations/    ← External service connections
  workers/           ← BullMQ background jobs
  utils/             ← Logger, errors, helpers
prisma/
  schema.prisma
  seed.ts
```

---

## API Overview

Full interactive docs at `/docs` (Scalar UI).

Base path: `/api/v1`

| Module | Endpoints |
|---|---|
| Auth | POST /auth/login, POST /auth/register, GET /auth/github, POST /auth/refresh |
| Users | GET/POST/PATCH/DELETE /users |
| Companies | GET/POST/PATCH /companies |
| Revenue | GET/POST /revenue, GET /revenue/analytics |
| Leakages | GET/POST/PATCH /leakages |
| Billing | GET /billing/subscription, POST /billing/stripe-webhook |
| Integrations | GET/POST/DELETE /integrations |

---

## Related Repos

| Repo | Purpose |
|---|---|
| [revsecurecloudfrontend](https://github.com/jagadishsahuai2022/revsecurecloudfrontend) | Vue 3 + Vite dashboard |
| [revsecureclouddb](https://github.com/jagadishsahuai2022/revsecureclouddb) | Prisma schema + migrations |
