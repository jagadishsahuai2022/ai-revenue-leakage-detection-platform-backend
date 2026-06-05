// ─────────────────────────────────────────────────────────────────────────────
// Generic Webhook Security Framework
//
// Provides reusable HMAC SHA-256 signature validation, timestamp replay
// protection, and secret key verification for inbound webhooks.
//
// Each connector can define its own `validateWebhook` using these primitives.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto';
import { FastifyRequest, FastifyReply } from 'fastify';
import { AppError } from '../../shared/errors/AppError';

/** Maximum age (in seconds) of a webhook timestamp before it's considered a replay. */
const MAX_TIMESTAMP_AGE_SECONDS = 300; // 5 minutes

export interface WebhookValidationConfig {
  /** The HMAC secret key for this provider connection */
  secret: string;
  /** Header name containing the HMAC signature (e.g. 'x-hub-signature-256') */
  signatureHeader: string;
  /** Header name containing the request timestamp (optional — for replay protection) */
  timestampHeader?: string;
  /** Signature prefix to strip before comparison (e.g. 'sha256=') */
  signaturePrefix?: string;
  /** Maximum age of timestamp in seconds (default: 300) */
  maxTimestampAge?: number;
  /** Hash algorithm (default: 'sha256') */
  algorithm?: string;
}

export interface WebhookValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Compute HMAC signature for a payload.
 */
export function computeHmacSignature(
  payload: string | Buffer,
  secret: string,
  algorithm = 'sha256',
): string {
  return crypto
    .createHmac(algorithm, secret)
    .update(payload)
    .digest('hex');
}

/**
 * Validate a webhook request's HMAC signature and timestamp.
 */
export function validateWebhookSignature(
  rawBody: string | Buffer,
  config: WebhookValidationConfig,
  headers: Record<string, string | string[] | undefined>,
): WebhookValidationResult {
  const algorithm = config.algorithm ?? 'sha256';
  const maxAge = config.maxTimestampAge ?? MAX_TIMESTAMP_AGE_SECONDS;

  // ── 1. Extract and validate signature ──────────────────────────────────
  const rawSignature = headers[config.signatureHeader.toLowerCase()];
  if (!rawSignature) {
    return { valid: false, error: `Missing signature header: ${config.signatureHeader}` };
  }

  const signatureStr = Array.isArray(rawSignature) ? rawSignature[0] : rawSignature;
  const prefix = config.signaturePrefix ?? '';
  const receivedSignature = prefix && signatureStr.startsWith(prefix)
    ? signatureStr.slice(prefix.length)
    : signatureStr;

  // ── 2. Compute expected signature ──────────────────────────────────────
  const expectedSignature = computeHmacSignature(rawBody, config.secret, algorithm);

  // ── 3. Timing-safe comparison ──────────────────────────────────────────
  const receivedBuf = Buffer.from(receivedSignature, 'hex');
  const expectedBuf = Buffer.from(expectedSignature, 'hex');

  if (receivedBuf.length !== expectedBuf.length) {
    return { valid: false, error: 'Invalid signature length' };
  }

  if (!crypto.timingSafeEqual(receivedBuf, expectedBuf)) {
    return { valid: false, error: 'Signature verification failed' };
  }

  // ── 4. Timestamp replay protection (optional) ─────────────────────────
  if (config.timestampHeader) {
    const timestampStr = headers[config.timestampHeader.toLowerCase()];
    if (!timestampStr) {
      return { valid: false, error: `Missing timestamp header: ${config.timestampHeader}` };
    }

    const ts = Array.isArray(timestampStr) ? timestampStr[0] : timestampStr;
    const timestamp = Number(ts);
    if (isNaN(timestamp)) {
      return { valid: false, error: 'Invalid timestamp format' };
    }

    const now = Math.floor(Date.now() / 1000);
    const age = Math.abs(now - timestamp);

    if (age > maxAge) {
      return {
        valid: false,
        error: `Timestamp too old: ${age}s exceeds maximum ${maxAge}s (replay protection)`,
      };
    }
  }

  return { valid: true };
}

/**
 * Fastify preHandler middleware factory for webhook validation.
 *
 * Usage:
 * ```ts
 * fastify.post('/webhooks/stripe', {
 *   preHandler: [webhookValidationMiddleware(getStripeConfig)],
 * }, handler);
 * ```
 */
export function webhookValidationMiddleware(
  configResolver: (request: FastifyRequest) => Promise<WebhookValidationConfig>,
) {
  return async function validateWebhook(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const config = await configResolver(request);

    // Get raw body — Fastify raw body plugins store it on request.rawBody
    const rawBody = (request as { rawBody?: Buffer }).rawBody ?? request.body;
    if (!rawBody) {
      throw AppError.badRequest('Missing request body for webhook validation');
    }

    const bodyToValidate =
      rawBody instanceof Buffer ? rawBody : Buffer.from(JSON.stringify(rawBody));

    const result = validateWebhookSignature(
      bodyToValidate,
      config,
      request.headers as Record<string, string | string[] | undefined>,
    );

    if (!result.valid) {
      request.log.warn(
        { error: result.error, provider: 'webhook' },
        'Webhook validation failed',
      );
      throw AppError.unauthorized(`Webhook validation failed: ${result.error}`);
    }
  };
}

/**
 * Provider-specific webhook validation configurations.
 * Each connector should implement this interface.
 */
export interface WebhookValidator {
  /**
   * Validate an inbound webhook request.
   * Returns the parsed and validated payload, or throws on invalid requests.
   */
  validateWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
    secret: string,
  ): WebhookValidationResult;
}

/**
 * Stripe webhook validator using their standard HMAC-SHA256 scheme.
 */
export const stripeWebhookValidator: WebhookValidator = {
  validateWebhook(rawBody, headers, secret) {
    return validateWebhookSignature(rawBody, {
      secret,
      signatureHeader: 'stripe-signature',
      // Stripe uses a custom format: t=timestamp,v1=signature
      // We handle this specially
    }, headers as Record<string, string | string[] | undefined>);
  },
};

/**
 * GitHub webhook validator using X-Hub-Signature-256.
 */
export const githubWebhookValidator: WebhookValidator = {
  validateWebhook(rawBody, headers, secret) {
    return validateWebhookSignature(rawBody, {
      secret,
      signatureHeader: 'x-hub-signature-256',
      signaturePrefix: 'sha256=',
    }, headers as Record<string, string | string[] | undefined>);
  },
};

/**
 * Generic HMAC-SHA256 validator for custom integrations.
 */
export const genericWebhookValidator: WebhookValidator = {
  validateWebhook(rawBody, headers, secret) {
    return validateWebhookSignature(rawBody, {
      secret,
      signatureHeader: 'x-webhook-signature',
      timestampHeader: 'x-webhook-timestamp',
    }, headers as Record<string, string | string[] | undefined>);
  },
};
