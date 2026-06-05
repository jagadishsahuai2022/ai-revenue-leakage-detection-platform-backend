// ─────────────────────────────────────────────────────────────────────────────
// Webhook Receiver Routes
//
// POST /webhooks/stripe   — Stripe payment events
// POST /webhooks/shopify  — Shopify order events
// POST /webhooks/square   — Square payment events
//
// All routes:
//   ✓ Validate HMAC signatures via webhookValidationMiddleware()
//   ✓ Deduplicate using WebhookEventLog
//   ✓ Upsert Revenue records
//   ✗ NO auth middleware (webhooks are validated via HMAC)
// ─────────────────────────────────────────────────────────────────────────────

import crypto from "node:crypto";
import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { PrismaClient } from "@prisma/client";
import {
  validateWebhookSignature,
  type WebhookValidationConfig,
} from "../../shared/middleware/webhook-validation";
import { decryptCredential } from "../../shared/utils/credential-encryption";
import { successResponse } from "../../shared/utils/response";

// ── Deduplication helper ────────────────────────────────────────────────────

/**
 * Check if a webhook event has already been processed.
 * If not, insert a record into WebhookEventLog and return false.
 * If yes, return true (duplicate).
 */
async function isDuplicateEvent(
  prisma: PrismaClient,
  provider: string,
  eventId: string,
  companyId: string | null,
  rawBody: Buffer | string,
): Promise<boolean> {
  const payloadHash = crypto
    .createHash("sha256")
    .update(typeof rawBody === "string" ? rawBody : rawBody.toString("utf8"))
    .digest("hex");

  try {
    await prisma.webhookEventLog.create({
      data: {
        provider,
        eventId,
        companyId,
        payloadHash,
      },
    });
    return false; // New event — not a duplicate
  } catch (error: any) {
    // Unique constraint violation → duplicate
    if (error?.code === "P2002") {
      return true;
    }
    throw error; // Unexpected error — rethrow
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Get the webhook secret for a provider from the first active ProviderConnection.
 * Falls back to env var for Stripe (legacy support).
 */
async function getWebhookSecret(
  prisma: PrismaClient,
  provider: string,
): Promise<{ secret: string; companyId: string } | null> {
  const connection = await prisma.providerConnection.findFirst({
    where: {
      provider: provider as any,
      status: "ACTIVE",
    },
    select: { companyId: true, encryptedConfig: true, apiKey: true },
  });

  if (!connection) return null;

  const config = connection.encryptedConfig as Record<string, unknown>;

  // Try webhookSecret from encryptedConfig first
  const encryptedSecret = (config?.webhookSecret as string) ?? null;
  if (encryptedSecret) {
    try {
      return {
        secret: decryptCredential(encryptedSecret),
        companyId: connection.companyId,
      };
    } catch {
      // Decryption failed — try plaintext
      return { secret: encryptedSecret, companyId: connection.companyId };
    }
  }

  return null;
}

// ── Route Registration ──────────────────────────────────────────────────────

export async function webhooksRoutes(fastify: FastifyInstance): Promise<void> {
  const prisma = fastify.prisma;

  // ── POST /webhooks/stripe ───────────────────────────────────────────────
  fastify.post(
    "/stripe",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const rawBody = (request as any).rawBody as Buffer | undefined;
      if (!rawBody) {
        return reply.status(400).send({ error: "Missing raw body" });
      }

      const signatureHeader = request.headers["stripe-signature"] as string;
      if (!signatureHeader) {
        return reply
          .status(400)
          .send({ error: "Missing Stripe-Signature header" });
      }

      // Get webhook secret — try env var first (legacy), then ProviderConnection
      let secret = process.env.STRIPE_WEBHOOK_SECRET || "";
      let companyId: string | null = null;

      if (!secret) {
        const connData = await getWebhookSecret(prisma, "STRIPE");
        if (!connData) {
          request.log.warn("No Stripe webhook secret configured");
          return reply
            .status(400)
            .send({ error: "Stripe webhook not configured" });
        }
        secret = connData.secret;
        companyId = connData.companyId;
      }

      // Validate Stripe signature
      // Stripe uses t=<timestamp>,v1=<signature> format
      const parts = signatureHeader.split(",");
      const timestampPart = parts.find((p) => p.startsWith("t="));
      const sigPart = parts.find((p) => p.startsWith("v1="));

      if (!timestampPart || !sigPart) {
        return reply
          .status(400)
          .send({ error: "Invalid Stripe-Signature format" });
      }

      const timestamp = timestampPart.replace("t=", "");
      const signature = sigPart.replace("v1=", "");

      // Stripe signed payload format: {timestamp}.{rawBody}
      const signedPayload = `${timestamp}.${rawBody.toString("utf8")}`;
      const expectedSig = crypto
        .createHmac("sha256", secret)
        .update(signedPayload)
        .digest("hex");

      if (
        !crypto.timingSafeEqual(
          Buffer.from(signature, "hex"),
          Buffer.from(expectedSig, "hex"),
        )
      ) {
        request.log.warn("Stripe webhook signature verification failed");
        return reply
          .status(400)
          .send({ error: "Signature verification failed" });
      }

      // Parse event
      const event = request.body as Record<string, any>;
      const eventId = event?.id;
      const eventType = event?.type;

      if (!eventId) {
        return reply.status(400).send({ error: "Missing event.id" });
      }

      // If we don't have companyId yet, look it up from the active Stripe connection
      if (!companyId) {
        const conn = await prisma.providerConnection.findFirst({
          where: { provider: "STRIPE", status: "ACTIVE" },
          select: { companyId: true },
        });
        companyId = conn?.companyId ?? null;
      }

      // Deduplicate
      const isDupe = await isDuplicateEvent(
        prisma,
        "STRIPE",
        eventId,
        companyId,
        rawBody,
      );
      if (isDupe) {
        request.log.info(
          { eventId, eventType },
          "Stripe webhook duplicate — skipping",
        );
        return reply.status(200).send(successResponse({ duplicate: true }));
      }

      request.log.info(
        { eventId, eventType, companyId },
        "Processing Stripe webhook",
      );

      // Handle supported event types
      if (
        eventType === "payment_intent.succeeded" ||
        eventType === "charge.captured"
      ) {
        const obj = event?.data?.object;
        if (obj && companyId) {
          const amountCents = obj.amount ?? obj.amount_captured ?? 0;
          const currency = (obj.currency ?? "usd").toUpperCase();
          const externalId = obj.id ?? eventId;

          await prisma.revenue.upsert({
            where: { companyId_externalId: { companyId, externalId } },
            create: {
              companyId,
              externalId,
              customerId:
                typeof obj.customer === "string" ? obj.customer : null,
              amount: amountCents / 100,
              currency,
              period: new Date(
                (obj.created ?? Math.floor(Date.now() / 1000)) * 1000,
              ),
              source: "stripe",
              metadata: { eventType, eventId } as object,
            },
            update: {
              metadata: {
                eventType,
                eventId,
                updatedViaWebhook: true,
              } as object,
            },
          });

          request.log.info(
            { externalId, companyId },
            "Stripe revenue upserted via webhook",
          );
        }
      }

      return reply
        .status(200)
        .send(successResponse({ received: true, eventType }));
    },
  );

  // ── POST /webhooks/shopify ──────────────────────────────────────────────
  fastify.post(
    "/shopify",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const rawBody = (request as any).rawBody as Buffer | undefined;
      if (!rawBody) {
        return reply.status(400).send({ error: "Missing raw body" });
      }

      const hmacHeader = request.headers["x-shopify-hmac-sha256"] as string;
      if (!hmacHeader) {
        return reply
          .status(400)
          .send({ error: "Missing X-Shopify-Hmac-SHA256 header" });
      }

      const webhookId = request.headers["x-shopify-webhook-id"] as string;
      const topic = request.headers["x-shopify-topic"] as string;

      // Get webhook secret from ProviderConnection
      const connData = await getWebhookSecret(prisma, "SHOPIFY");
      if (!connData) {
        request.log.warn("No Shopify webhook secret configured");
        return reply
          .status(400)
          .send({ error: "Shopify webhook not configured" });
      }

      // Validate HMAC-SHA256 — Shopify sends base64-encoded HMAC
      const expectedHmac = crypto
        .createHmac("sha256", connData.secret)
        .update(rawBody)
        .digest("base64");

      if (hmacHeader !== expectedHmac) {
        request.log.warn("Shopify webhook HMAC verification failed");
        return reply.status(401).send({ error: "HMAC verification failed" });
      }

      // Deduplicate using X-Shopify-Webhook-Id
      const eventId =
        webhookId || crypto.createHash("sha256").update(rawBody).digest("hex");
      const isDupe = await isDuplicateEvent(
        prisma,
        "SHOPIFY",
        eventId,
        connData.companyId,
        rawBody,
      );
      if (isDupe) {
        request.log.info(
          { eventId, topic },
          "Shopify webhook duplicate — skipping",
        );
        return reply.status(200).send(successResponse({ duplicate: true }));
      }

      request.log.info(
        { eventId, topic, companyId: connData.companyId },
        "Processing Shopify webhook",
      );

      // Handle orders/paid topic
      if (topic === "orders/paid") {
        const order = request.body as Record<string, any>;
        const externalId = `shopify_order_${order?.id ?? eventId}`;
        const totalPrice = parseFloat(order?.total_price ?? "0");
        const currency = (order?.currency ?? "USD").toUpperCase();

        await prisma.revenue.upsert({
          where: {
            companyId_externalId: { companyId: connData.companyId, externalId },
          },
          create: {
            companyId: connData.companyId,
            externalId,
            customerId: order?.customer?.id?.toString() ?? null,
            customerEmail: order?.customer?.email ?? null,
            amount: totalPrice,
            currency,
            period: new Date(order?.created_at ?? Date.now()),
            source: "shopify",
            metadata: {
              topic,
              orderId: order?.id,
              webhookId: eventId,
            } as object,
          },
          update: {
            metadata: {
              topic,
              orderId: order?.id,
              webhookId: eventId,
              updatedViaWebhook: true,
            } as object,
          },
        });

        request.log.info(
          { externalId, companyId: connData.companyId },
          "Shopify revenue upserted via webhook",
        );
      }

      return reply.status(200).send(successResponse({ received: true, topic }));
    },
  );

  // ── POST /webhooks/square ───────────────────────────────────────────────
  fastify.post(
    "/square",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const rawBody = (request as any).rawBody as Buffer | undefined;
      if (!rawBody) {
        return reply.status(400).send({ error: "Missing raw body" });
      }

      const signatureHeader = request.headers["x-square-signature"] as string;
      if (!signatureHeader) {
        // Square also uses x-square-hmacsha256-signature in some cases
        const altHeader = request.headers[
          "x-square-hmacsha256-signature"
        ] as string;
        if (!altHeader) {
          return reply
            .status(400)
            .send({ error: "Missing Square signature header" });
        }
      }

      // Get webhook secret from ProviderConnection
      const connData = await getWebhookSecret(prisma, "SQUARE");
      if (!connData) {
        request.log.warn("No Square webhook secret configured");
        return reply
          .status(400)
          .send({ error: "Square webhook not configured" });
      }

      // Validate HMAC signature
      const signature =
        signatureHeader ||
        (request.headers["x-square-hmacsha256-signature"] as string);
      const webhookUrl = `${process.env.APP_URL ?? "https://api.revsecurecloud.com"}/webhooks/square`;
      const signedPayload = webhookUrl + rawBody.toString("utf8");
      const expectedSig = crypto
        .createHmac("sha256", connData.secret)
        .update(signedPayload)
        .digest("base64");

      if (signature !== expectedSig) {
        request.log.warn("Square webhook signature verification failed");
        return reply
          .status(401)
          .send({ error: "Signature verification failed" });
      }

      // Parse event
      const body = request.body as Record<string, any>;
      const eventId =
        body?.event_id ??
        body?.data?.id ??
        crypto.createHash("sha256").update(rawBody).digest("hex");
      const eventType = body?.type;

      // Deduplicate
      const isDupe = await isDuplicateEvent(
        prisma,
        "SQUARE",
        eventId,
        connData.companyId,
        rawBody,
      );
      if (isDupe) {
        request.log.info(
          { eventId, eventType },
          "Square webhook duplicate — skipping",
        );
        return reply.status(200).send(successResponse({ duplicate: true }));
      }

      request.log.info(
        { eventId, eventType, companyId: connData.companyId },
        "Processing Square webhook",
      );

      // Handle payment.completed
      if (
        eventType === "payment.completed" ||
        eventType === "payment.updated"
      ) {
        const payment = body?.data?.object?.payment ?? body?.data?.object;
        if (payment) {
          const amountMoney = payment?.amount_money ?? payment?.total_money;
          const amountCents = amountMoney?.amount ?? 0;
          const currency = (amountMoney?.currency ?? "USD").toUpperCase();
          const externalId = `square_${payment?.id ?? eventId}`;

          await prisma.revenue.upsert({
            where: {
              companyId_externalId: {
                companyId: connData.companyId,
                externalId,
              },
            },
            create: {
              companyId: connData.companyId,
              externalId,
              customerId: payment?.customer_id ?? null,
              amount: amountCents / 100,
              currency,
              period: new Date(payment?.created_at ?? Date.now()),
              source: "square",
              metadata: { eventType, eventId } as object,
            },
            update: {
              metadata: {
                eventType,
                eventId,
                updatedViaWebhook: true,
              } as object,
            },
          });

          request.log.info(
            { externalId, companyId: connData.companyId },
            "Square revenue upserted via webhook",
          );
        }
      }

      return reply
        .status(200)
        .send(successResponse({ received: true, eventType }));
    },
  );
}
