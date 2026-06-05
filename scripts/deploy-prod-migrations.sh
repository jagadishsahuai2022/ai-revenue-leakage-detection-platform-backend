#!/usr/bin/env bash
# deploy-prod-migrations.sh
# Usage:
#  - Ensure the environment variable DATABASE_URL is set to the production Neon DB.
#  - Recommend taking a DB snapshot/backup before running.
#  - Run on the production host / CI agent from the repo root:
#      ./revsecurecloudbackend/scripts/deploy-prod-migrations.sh

set -euo pipefail

if [ -z "${DATABASE_URL-}" ]; then
  echo "ERROR: DATABASE_URL is not set. Export DATABASE_URL and retry."
  exit 2
fi

echo "Using DATABASE_URL (partial): ${DATABASE_URL:0:40}..."
echo "Running: npx prisma migrate deploy --schema prisma/schema.prisma"

npx prisma migrate deploy --schema prisma/schema.prisma

echo "Prisma migrate deploy completed. Regenerating Prisma client..."
npx prisma generate

echo "Done."
