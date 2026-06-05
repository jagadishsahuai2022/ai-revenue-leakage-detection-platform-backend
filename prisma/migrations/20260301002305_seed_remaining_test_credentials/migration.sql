-- ─────────────────────────────────────────────────────────────────────────────
-- Data migration: seed test credentials for GitHub, Slack, and QuickBooks.
-- ON CONFLICT ensures idempotency.
--
-- IMPORTANT: These are sandbox/test credentials only — NEVER use production keys.
-- Credential keys MUST match each provider's Connect modal field definitions.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO test_credentials (id, "providerId", label, credentials, "isActive", "createdAt", "updatedAt")
VALUES
  (
    gen_random_uuid(),
    'github',
    'GitHub Test Account',
    '{"accessToken": "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}',
    true,
    NOW(),
    NOW()
  ),
  (
    gen_random_uuid(),
    'slack',
    'Slack Sandbox',
    '{"webhookUrl": "https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX", "botToken": "xoxb-000000000000-000000000000-xxxxxxxxxxxxxxxxxxxxxxxx"}',
    true,
    NOW(),
    NOW()
  ),
  (
    gen_random_uuid(),
    'quickbooks',
    'QuickBooks Sandbox',
    '{"clientId": "ABxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", "clientSecret": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}',
    true,
    NOW(),
    NOW()
  )
ON CONFLICT ("providerId") DO UPDATE SET
  label        = EXCLUDED.label,
  credentials  = EXCLUDED.credentials,
  "isActive"   = EXCLUDED."isActive",
  "updatedAt"  = NOW();