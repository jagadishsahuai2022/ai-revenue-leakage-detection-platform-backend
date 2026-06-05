# RevSecureCloud — Database Migration Plan

> Generated: 2026-03-09  
> Backend repo: `revsecurecloudbackend`  
> DB engine: PostgreSQL (local Docker · Neon on cloud)

---

## 1. Current Migration State

| Environment                      | Status                                                    |
| -------------------------------- | --------------------------------------------------------- |
| **Local (`revsecurecloud_dev`)** | ✅ **Up to date** — all 26 migrations applied             |
| **Cloud (Neon production)**      | ⚠️ Must be verified & run before deploying the backend PR |

---

## 2. Full Migration Registry (26 migrations)

| #   | Migration ID                                           | What it does                                                                                            |
| --- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| 1   | `20260228120000_add_data_migration_history`            | Creates `DataMigrationHistory` table (idempotency tracker for data migrations)                          |
| 2   | `20260228162239_add_data_migration_history`            | **Baseline** — Full initial schema: `Company`, `User`, `Revenue`, `Leakage`, `Integration`, enums, RBAC |
| 3   | `20260228172119_add_audit_log_actor_fields`            | Adds `actorId`, `actorRole`, `actorEmail` to `AuditLog`                                                 |
| 4   | `20260228175936_add_user_preferences`                  | Adds `preferences JSONB` column to `User`                                                               |
| 5   | `20260228204144_add_connector_engine_v2_models`        | Creates `ProviderConnection`, connector v2 tables                                                       |
| 6   | `20260228234051_add_custom_providers`                  | Creates `CustomProvider` table                                                                          |
| 7   | `20260228234459_add_provider_icons_table`              | Creates `provider_icons` lookup table                                                                   |
| 8   | `20260228234509_seed_builtin_provider_icons`           | Seeds built-in provider icon presets (idempotent ON CONFLICT)                                           |
| 9   | `20260301001011_add_test_credentials_table`            | Creates `test_credentials` sandbox table                                                                |
| 10  | `20260301001027_seed_test_credentials`                 | Seeds Stripe, Square, PayPal sandbox credentials (idempotent)                                           |
| 11  | `20260301002305_seed_remaining_test_credentials`       | Seeds GitHub, Slack, QuickBooks sandbox credentials (idempotent)                                        |
| 12  | `20260301023926_add_ai_engine_models`                  | Creates `ai_insights`, `ai_recommendations`, `ai_safety_logs` tables                                    |
| 13  | `20260301032302_add_ai_usage_table`                    | Creates `ai_usage` metering table                                                                       |
| 14  | `20260301050000_add_insight_id_to_safety_log`          | Adds `insightId` soft-link to `ai_safety_logs`                                                          |
| 15  | `20260303034028_add_ai_multi_model`                    | Adds `modelId` column to `ai_insights`                                                                  |
| 16  | `20260303070429_add_agent_module`                      | Creates `agent_action_proposals` and related agent tables                                               |
| 17  | `20260304192521_add_copilot_models`                    | Adds `before`/`after` JSONB columns to `AuditLog`                                                       |
| 18  | `20260304200133_add_enterprise_governance_models`      | Creates `api_idempotency_keys` and enterprise governance tables                                         |
| 19  | `20260305000000_enterprise_integration_upgrade`        | Adds encrypted credential fields + incremental sync columns to integrations                             |
| 20  | `20260305120000_add_integration_providers`             | Extends `IntegrationProvider` enum: adds `SQUARE`, `PAYPAL`, `SHOPIFY`, etc.                            |
| 21  | `20260306120000_add_webhook_event_log_and_webhook_url` | Adds `webhookUrl` to `ProviderConnection`; creates `WebhookEventLog` table                              |
| 22  | `20260307122851_add_agent_execution_metrics`           | Creates `agent_execution_metrics` table for cron job analytics                                          |
| 23  | `20260308060623_agent_policy_schema`                   | Adds `impactScore`, `riskScore`, policy columns to `agent_action_proposals`                             |
| 24  | `20260308095525_add_telemetry_explanation_guardrail`   | Adds `explanation` column to `ai_recommendations`                                                       |
| 25  | `20260308105609_add_localization_typography`           | Adds `defaultLanguage`, `defaultCurrency`, typography settings to `Company`                             |
| 26  | `20260308124207_add_translation_override_cache`        | Creates `translation_overrides` table                                                                   |

### Data Migrations (separate runner, `src/infrastructure/data-migrations/`)

| #   | File                         | What it does                                                          |
| --- | ---------------------------- | --------------------------------------------------------------------- |
| 1   | `001_backfill_audit_logs.ts` | Backfills missing actor fields on existing AuditLog rows (idempotent) |

---

## 3. Local Development Deployment

> **Precondition:** Docker Compose Postgres is running on `localhost:5432`

### Step 1 — Verify current state

```powershell
cd revsecurecloudbackend
npx prisma migrate status
```

Expected output: `Database schema is up to date!`

### Step 2 — Apply any future schema migrations (dev)

```powershell
npm run db:migrate        # = npx prisma migrate dev
```

Use this when adding new schema changes during development. Creates migration files.

### Step 3 — Run data migrations

```powershell
npm run db:migrate:data   # = tsx scripts/run-data-migrations.ts
```

Idempotent — already-executed migrations are skipped.

### Step 4 — Regenerate Prisma client (if schema changed)

```powershell
npm run db:generate       # = npx prisma generate
```

### Step 5 — Seed reference/demo data (optional, dev only)

```powershell
npm run db:seed           # base seed (company + admin user)
npm run seed:ai-models    # seed AI model definitions
npm run demo:seed         # optional demo data
```

---

## 4. Cloud (Production / Neon) Deployment — Backend PR

> **NEVER run `prisma migrate dev` against production.** Use `prisma migrate deploy` only.
> The `PROD_DATABASE_URL` must **never** be committed. Store it in GitHub Secrets.

### Pre-deployment checklist

- [ ] All 26 migrations are committed and pushed in the backend PR
- [ ] `PROD_DATABASE_URL` is set in GitHub Secrets (or your shell for manual run)
- [ ] Production DB snapshot / point-in-time recovery is enabled on Neon (recommended before any deployment)
- [ ] At least one Neon manual backup taken: `Neon Console → Project → Branches → main → Restore point`

---

### Option A — Automated (Dockerfile entrypoint — recommended)

The `Dockerfile` already handles migrations automatically on every container start:

```dockerfile
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
```

**This means:** When your cloud provider (Railway / Render / ECS / Fly.io) deploys the new backend image, it will:

1. Run `prisma migrate deploy` — applies all unapplied migrations in order
2. Start the API server

**No manual steps required** as long as the container's `DATABASE_URL` env var is set to the Neon connection string.

---

### Option B — Manual pre-deployment run (from local machine)

Use this when you want to migrate before the new image is live (zero-downtime migration):

```powershell
# 1. Set PROD_DATABASE_URL in your local .env (gitignored) or pass inline
$env:PROD_DATABASE_URL = "postgresql://<user>:<pass>@<neon-host>/<db>?sslmode=require"

# 2. Run the prod migration helper
cd revsecurecloudbackend
node scripts/run-prod-migrations.js
```

The script:

1. Backs up `.env` to `.env.migration-backup`
2. Resolves baseline migration `20260228162239` as already applied (prevents re-creating tables)
3. Runs `npx prisma migrate deploy` (applies only unapplied migrations)
4. Runs `npx prisma generate`
5. Prints `npx prisma migrate status`
6. Restores original `.env`

---

### Option C — Direct CLI (CI/CD pipeline)

Add to your GitHub Actions backend workflow:

```yaml
- name: Run DB migrations
  env:
    DATABASE_URL: ${{ secrets.PROD_DATABASE_URL }}
  run: |
    cd revsecurecloudbackend
    npx prisma migrate deploy
    npx prisma generate
```

---

### Post-deployment steps (cloud)

```powershell
# 1. Verify all 26 migrations applied
$env:PROD_DATABASE_URL = "postgresql://..."
$env:DATABASE_URL = $env:PROD_DATABASE_URL
npx prisma migrate status

# 2. Run data migrations against production
$env:DATABASE_URL = $env:PROD_DATABASE_URL
npm run db:migrate:data
```

---

## 5. PR Separation Strategy

Since you have separate PRs for frontend and backend:

### Backend PR — includes migrations

**Merge order:** Backend PR must be merged & deployed **before** the frontend PR goes live if any migration adds columns/tables that the old API version does not support.

| Layer           | Action on merge                                                        | Notes                            |
| --------------- | ---------------------------------------------------------------------- | -------------------------------- |
| **Backend PR**  | Docker image rebuilt → container starts → `prisma migrate deploy` runs | Migrations applied automatically |
| **Backend PR**  | `npm run db:migrate:data` run manually post-deploy                     | One-time data backfill           |
| **Frontend PR** | Can be deployed independently                                          | No DB dependency                 |

**Safe migration order for this batch (all additive — no destructive changes):**

1. Deploy backend PR (migrations run automatically in container)
2. Verify `/health` endpoint responds
3. Verify `prisma migrate status` shows `up to date`
4. Run data migrations if any new ones were added
5. Deploy frontend PR (independent, no DB contact)

---

## 6. Rollback Plan

All 26 migrations are **additive only** (no DROP TABLE, no DROP COLUMN, no destructive ALTER). This means:

- Rolling back the **backend code** to a previous version is safe — old code ignores new nullable columns
- If a migration failure occurs mid-deploy, Prisma rolls back that specific transaction automatically
- To revert a column addition manually if needed:
  ```sql
  -- Example: revert translation_overrides table
  DROP TABLE IF EXISTS "translation_overrides";
  -- Then mark migration as rolled back in Prisma's _prisma_migrations table:
  DELETE FROM "_prisma_migrations" WHERE migration_name = '20260308124207_add_translation_override_cache';
  ```

---

## 7. Quick Reference Scripts

```powershell
# LOCAL — check status
cd revsecurecloudbackend
npx prisma migrate status

# LOCAL — apply all pending (dev mode, creates migration if schema changed)
npm run db:migrate

# LOCAL — apply pending (deploy mode, no new migrations, safe for CI)
npm run db:migrate:prod

# LOCAL — run data migrations
npm run db:migrate:data

# PROD — run schema migrations from local machine
$env:PROD_DATABASE_URL = "postgresql://..."
node scripts/run-prod-migrations.js

# PROD — run data migrations from local machine
$env:DATABASE_URL = $env:PROD_DATABASE_URL
npm run db:migrate:data

# PROD — open Prisma Studio (local DB)
npm run db:studio
```

---

## 8. Environment Variable Requirements

| Variable             | Local                                                              | Cloud                  | Description                                   |
| -------------------- | ------------------------------------------------------------------ | ---------------------- | --------------------------------------------- |
| `DATABASE_URL`       | `postgresql://postgres:postgres@localhost:5432/revsecurecloud_dev` | Neon connection string | Primary DB URL used by Prisma + app           |
| `PROD_DATABASE_URL`  | Set in local `.env` (gitignored)                                   | Set in GitHub Secrets  | Used ONLY by `run-prod-migrations.js` locally |
| `NODE_ENV`           | `development`                                                      | `production`           | Controls rate limits, logging, CORS           |
| `JWT_SECRET`         | Any string (dev)                                                   | Strong 32+ char secret | Must be set before first login                |
| `JWT_REFRESH_SECRET` | Any string (dev)                                                   | Strong 32+ char secret | Must be set before first login                |

See `.env.example` for the full list and `.env.production` for cloud-specific values.
