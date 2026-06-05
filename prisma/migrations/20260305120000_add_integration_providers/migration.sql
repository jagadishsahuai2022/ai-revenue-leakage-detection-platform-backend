-- ============================================================
-- Migration: add_integration_providers
-- Purpose  : Extend IntegrationProvider enum with SQUARE, PAYPAL,
--            SHOPIFY, QUICKBOOKS, XERO so the enterprise connect
--            endpoint accepts all supported payment/accounting providers.
-- ============================================================

-- PostgreSQL requires adding enum values with ALTER TYPE.
-- The IF NOT EXISTS guard (PG 9.6+) makes this idempotent.

ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS 'SQUARE';
ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS 'PAYPAL';
ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS 'SHOPIFY';
ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS 'QUICKBOOKS';
ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS 'XERO';
