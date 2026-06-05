import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';

import {
  RevenueProvider,
  NormalizedTransaction,
  NormalizedSubscription,
  ConnectorEvent,
} from '../../../domain/connectors';
import { AppError } from '../../../shared/errors/AppError';
import { env } from '../../../config/env';

/**
 * Stripe adapter — implements `RevenueProvider` using the Stripe SDK.
 *
 * Retrieves the Stripe customer ID from the company record, then pages
 * through charges and subscriptions to produce normalised domain objects.
 *
 * This class MAY import Prisma/Stripe. The domain interface must not.
 */
export class StripeAdapter implements RevenueProvider {
  readonly providerId = 'STRIPE';

  private readonly stripe: Stripe;

  private get stripeEnabled(): boolean {
    return !!env.STRIPE_SECRET_KEY && env.STRIPE_SECRET_KEY !== 'sk_test_...';
  }

  constructor(private readonly prisma: PrismaClient) {
    this.stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private async getCustomerId(companyId: string): Promise<string> {
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { stripeCustomerId: true },
    });

    if (!company.stripeCustomerId) {
      throw AppError.badRequest(`Company ${companyId} has no Stripe customer linked`);
    }

    return company.stripeCustomerId;
  }

  // ── RevenueProvider implementation ────────────────────────────────────────

  async testConnection(companyId: string): Promise<boolean> {
    if (!this.stripeEnabled) return false;
    try {
      const customerId = await this.getCustomerId(companyId);
      await this.stripe.customers.retrieve(customerId);
      return true;
    } catch {
      return false;
    }
  }

  async fetchTransactions(
    companyId: string,
    since?: Date,
  ): Promise<NormalizedTransaction[]> {
    if (!this.stripeEnabled) return [];

    const customerId = await this.getCustomerId(companyId);

    const params: Stripe.ChargeListParams = {
      customer: customerId,
      limit: 100,
    };

    if (since) {
      params.created = { gte: Math.floor(since.getTime() / 1000) };
    }

    const charges = await this.stripe.charges.list(params);

    return charges.data.map((charge): NormalizedTransaction => ({
      externalId: charge.id,
      currency: charge.currency,
      amountCents: charge.amount,
      occurredAt: new Date(charge.created * 1000),
      description: charge.description ?? undefined,
      customerId: typeof charge.customer === 'string' ? charge.customer : charge.customer?.id,
      status: charge.status,
      metadata: charge.metadata as Record<string, unknown>,
    }));
  }

  async fetchSubscriptions(companyId: string): Promise<NormalizedSubscription[]> {
    if (!this.stripeEnabled) return [];

    const customerId = await this.getCustomerId(companyId);

    const subscriptions = await this.stripe.subscriptions.list({
      customer: customerId,
      limit: 100,
      status: 'all',
    });

    return subscriptions.data.map((sub): NormalizedSubscription => {
      const item = sub.items.data[0];
      const price = item?.price;

      return {
        externalId: sub.id,
        customerId,
        currency: sub.currency,
        amountCents: price?.unit_amount ?? 0,
        interval: price?.recurring?.interval ?? 'month',
        status: sub.status,
        startedAt: new Date(sub.created * 1000),
        currentPeriodEndsAt: new Date(sub.current_period_end * 1000),
        canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : undefined,
        metadata: sub.metadata as Record<string, unknown>,
      };
    });
  }

  /**
   * Handles inbound Stripe webhooks — verifies signature then returns
   * normalised `ConnectorEvent` objects for downstream processing.
   */
  async handleWebhook(
    companyId: string,
    rawBody: Buffer,
    headers: Record<string, string>,
  ): Promise<ConnectorEvent[]> {
    if (!this.stripeEnabled) return [];

    let event: Stripe.Event;

    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        headers['stripe-signature'] ?? '',
        env.STRIPE_WEBHOOK_SECRET,
      );
    } catch {
      throw AppError.badRequest('Invalid Stripe webhook signature');
    }

    const now = new Date();

    const domainEventType = ((): string => {
      switch (event.type) {
        case 'charge.succeeded':
        case 'payment_intent.succeeded':
          return 'TRANSACTION_RECEIVED';
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
          return 'SUBSCRIPTION_RECEIVED';
        default:
          return 'WEBHOOK_RECEIVED';
      }
    })();

    return [
      {
        provider: this.providerId,
        companyId,
        eventType: domainEventType,
        externalId: event.id,
        rawPayload: event as unknown as Record<string, unknown>,
        occurredAt: now,
      },
    ];
  }
}
