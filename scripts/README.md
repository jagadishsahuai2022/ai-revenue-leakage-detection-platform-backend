# Production migration helpers

This folder contains helper scripts to apply Prisma migrations to production (Neon) safely.

Files

- `deploy-prod-migrations.ps1` — PowerShell helper for Windows/CI running on Windows agents.
- `deploy-prod-migrations.sh` — POSIX shell helper for Linux/CI agents.

Recommended procedure

1. Take a production DB snapshot/backup (Neon provides a snapshot UI; use it).
2. Ensure the deployment host/CI has `DATABASE_URL` environment variable set to the production Neon connection string.
3. Run one of the scripts from the repository root:

PowerShell (Windows/CI):

```powershell
$env:DATABASE_URL = "postgresql://user:pass@host:5432/db?schema=public"
./revsecurecloudbackend/scripts/deploy-prod-migrations.ps1
```

Bash (Linux/CI):

```bash
export DATABASE_URL="postgresql://user:pass@host:5432/db?schema=public"
./revsecurecloudbackend/scripts/deploy-prod-migrations.sh
```

Notes & safety

- The scripts run `npx prisma migrate deploy` followed by `npx prisma generate`.
- If your deployment infra (Render) already runs `npx prisma migrate deploy` on container start, you can skip manual migration, but monitor deployment logs to ensure the migration runs successfully.
- If migrations perform destructive changes, test in staging first and take backups.
