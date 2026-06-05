-- ─────────────────────────────────────────────────────────────────────────────
-- Data migration: seed sandbox test credentials for Stripe, Square, and PayPal.
-- ON CONFLICT ("providerId") DO UPDATE ensures idempotency (safe to re-run).
--
-- IMPORTANT: These are sandbox/test credentials only — NEVER use production keys.
-- Credential keys MUST match the field `key` values used in each provider's
-- Connect modal (secretKey / publishableKey for Stripe, etc.).
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO test_credentials (id, "providerId", label, credentials, "isActive", "createdAt", "updatedAt")
VALUES
  (
    gen_random_uuid(),
    'stripe',
    'Stripe Test Account',
    '{"secretKey": "sk_test_51T5v6kDmHBxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", "publishableKey": "pk_test_51T5v6kDmHBxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}',
    true,
    NOW(),
    NOW()
  ),
  (
    gen_random_uuid(),
    'square',
    'Square Sandbox',
    '{"appId": "sandbox-sq0idb-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", "accessToken": "EAAAl7sntIZhYttXZxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}',
    true,
    NOW(),
    NOW()
  ),
  (
    gen_random_uuid(),
    'paypal',
    'PayPal Sandbox',
    '{"clientId": "AZRuqQ04856YXSSNNyxOJxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", "clientSecret": "EImWkXPnv9HzfBZeRz77oCxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}',
    true,
    NOW(),
    NOW()
  )
ON CONFLICT ("providerId") DO UPDATE SET
  label        = EXCLUDED.label,
  credentials  = EXCLUDED.credentials,
  "isActive"   = EXCLUDED."isActive",
  "updatedAt"  = NOW();