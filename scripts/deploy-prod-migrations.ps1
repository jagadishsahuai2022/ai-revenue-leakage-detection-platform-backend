<#
deploy-prod-migrations.ps1

Usage:
  - Ensure the environment variable `DATABASE_URL` points to the production Neon DB.
  - (Optional) Take a snapshot/backup of the production DB before running.
  - Run this script on the production host or CI agent with PowerShell:
      ./scripts/deploy-prod-migrations.ps1

This script runs `npx prisma migrate deploy` using the repository's Prisma schema
and exits with the same code as the migrate command.
#>

if (-not $env:DATABASE_URL) {
    Write-Error "DATABASE_URL is not set. Set the DATABASE_URL environment variable to your production Neon database connection string and retry."
    exit 2
}

Write-Host "Using DATABASE_URL: $($env:DATABASE_URL.Substring(0, [Math]::Min(40, $env:DATABASE_URL.Length)))..."

Push-Location -Path (Resolve-Path "$PSScriptRoot/..")
try {
    Write-Host "Running: npx prisma migrate deploy --schema prisma/schema.prisma"
    $process = Start-Process -FilePath "npx" -ArgumentList "prisma migrate deploy --schema prisma/schema.prisma" -NoNewWindow -Wait -PassThru -RedirectStandardOutput stdout.txt -RedirectStandardError stderr.txt
    Get-Content stdout.txt -Tail 200
    if ($process.ExitCode -ne 0) {
        Write-Error "Migration failed with exit code $($process.ExitCode). See stderr.txt for details."
        Get-Content stderr.txt -Tail 200
        exit $process.ExitCode
    }
    Write-Host "Migrations applied successfully. Regenerating Prisma client..."
    npx prisma generate
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Prisma client generation failed (exit code $LASTEXITCODE)."
        exit $LASTEXITCODE
    }
    Write-Host "Done."
}
finally {
    Pop-Location
}
