import { PrismaClient, SubscriptionPlan, SubscriptionStatus } from '@prisma/client';
import Stripe from 'stripe';
import { AppError } from '../../shared/errors/AppError';
import { env } from '../../config/env';
import { STRIPE_PLANS } from '../../config/constants';

export class BillingService {
  private stripe: Stripe;

  constructor(private readonly prisma: PrismaClient) {
    this.stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
  }

  private get stripeEnabled() {
    return !!env.STRIPE_SECRET_KEY && env.STRIPE_SECRET_KEY !== 'sk_test_...';
  }

  // ── Customer ─────────────────────────────────────────────────────────────────
  async getOrCreateCustomer(companyId: string): Promise<string> {
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });

    if (company.stripeCustomerId) return company.stripeCustomerId;

    if (!this.stripeEnabled) throw AppError.internal('Stripe is not configured');

    const customer = await this.stripe.customers.create({
      email: company.billingEmail ?? undefined,
      name: company.name,
      metadata: { companyId },
    });

    await this.prisma.company.update({
      where: { id: companyId },
      data: { stripeCustomerId: customer.id },
    });

    return customer.id;
  }

  // ── Checkout ──────────────────────────────────────────────────────────────────
  async createCheckoutSession(companyId: string, plan: SubscriptionPlan, successUrl: string, cancelUrl: string) {
    if (!this.stripeEnabled) throw AppError.internal('Stripe is not configured');

    const priceId = STRIPE_PLANS[plan];
    if (!priceId) throw AppError.badRequest(`No price configured for plan: ${plan}`);

    const customerId = await this.getOrCreateCustomer(companyId);

    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { companyId, plan },
      subscription_data: { metadata: { companyId, plan } },
      allow_promotion_codes: true,
    });

    return { sessionId: session.id, url: session.url };
  }

  // ── Customer Portal ───────────────────────────────────────────────────────────
  async createPortalSession(companyId: string, returnUrl: string) {
    if (!this.stripeEnabled) throw AppError.internal('Stripe is not configured');

    const customerId = await this.getOrCreateCustomer(companyId);

    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });

    return { url: session.url };
  }

  // ── Current Subscription ──────────────────────────────────────────────────────
  async getSubscription(companyId: string) {
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: {
        id: true,
        plan: true,
        subscriptionStatus: true,
        trialEndsAt: true,
        stripeCustomerId: true,
        subscriptionItems: true,
        invoices: { take: 5, orderBy: { createdAt: 'desc' } },
      },
    });
    return company;
  }

  // ── Invoices ──────────────────────────────────────────────────────────────────
  async getInvoices(companyId: string) {
    return this.prisma.invoice.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      take: 24,
    });
  }

  // ── Webhook Handler ───────────────────────────────────────────────────────────
  async handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
    if (!this.stripeEnabled) return;

    let event: Stripe.Event;

    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
    } catch {
      throw AppError.badRequest('Invalid Stripe webhook signature');
    }

    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await this.handleSubscriptionUpdate(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      case 'invoice.payment_succeeded':
        await this.handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;

      case 'invoice.payment_failed':
        await this.handleInvoiceFailed(event.data.object as Stripe.Invoice);
        break;

      default:
        break;
    }
  }

  private async handleCheckoutCompleted(session: Stripe.Checkout.Session) {
    const companyId = session.metadata?.['companyId'];
    if (!companyId) return;

    if (session.subscription) {
      const sub = await this.stripe.subscriptions.retrieve(session.subscription as string);
      await this.syncSubscription(companyId, sub);
    }
  }

  private async handleSubscriptionUpdate(subscription: Stripe.Subscription) {
    const companyId = subscription.metadata?.['companyId'];
    if (!companyId) {
      // Try to find company by customer ID
      const company = await this.prisma.company.findFirst({
        where: { stripeCustomerId: subscription.customer as string },
      });
      if (!company) return;
      await this.syncSubscription(company.id, subscription);
    } else {
      await this.syncSubscription(companyId, subscription);
    }
  }

  private async handleSubscriptionDeleted(subscription: Stripe.Subscription) {
    const company = await this.prisma.company.findFirst({
      where: { stripeCustomerId: subscription.customer as string },
    });
    if (!company) return;

    await this.prisma.company.update({
      where: { id: company.id },
      data: { subscriptionStatus: 'CANCELED' },
    });
  }

  private async handleInvoicePaid(invoice: Stripe.Invoice) {
    const company = await this.prisma.company.findFirst({
      where: { stripeCustomerId: invoice.customer as string },
    });
    if (!company) return;

    await this.prisma.invoice.upsert({
      where: { stripeInvoiceId: invoice.id },
      create: {
        companyId: company.id,
        stripeInvoiceId: invoice.id,
        stripeCustomerId: invoice.customer as string,
        amount: invoice.amount_paid / 100,
        currency: invoice.currency.toUpperCase(),
        status: 'paid',
        invoiceUrl: invoice.hosted_invoice_url ?? null,
        periodStart: invoice.period_start ? new Date(invoice.period_start * 1000) : null,
        periodEnd: invoice.period_end ? new Date(invoice.period_end * 1000) : null,
        paidAt: new Date(),
      },
      update: { status: 'paid', paidAt: new Date() },
    });
  }

  private async handleInvoiceFailed(invoice: Stripe.Invoice) {
    const company = await this.prisma.company.findFirst({
      where: { stripeCustomerId: invoice.customer as string },
    });
    if (!company) return;

    await this.prisma.company.update({
      where: { id: company.id },
      data: { subscriptionStatus: 'PAST_DUE' },
    });
  }

  private async syncSubscription(companyId: string, subscription: Stripe.Subscription) {
    const planMeta = subscription.metadata?.['plan'] as SubscriptionPlan | undefined;
    const plan = planMeta ?? this.inferPlanFromPrice(subscription);

    const status = this.mapStripeStatus(subscription.status);

    await Promise.all([
      this.prisma.company.update({
        where: { id: companyId },
        data: {
          plan,
          subscriptionStatus: status,
          subscriptionId: subscription.id,
        },
      }),
      this.prisma.subscriptionItem.upsert({
        where: { stripeSubscriptionId: subscription.id },
        create: {
          companyId,
          stripeSubscriptionId: subscription.id,
          stripePriceId: subscription.items.data[0]?.price.id ?? '',
          plan,
          status,
          currentPeriodStart: new Date(subscription.current_period_start * 1000),
          currentPeriodEnd: new Date(subscription.current_period_end * 1000),
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
        },
        update: {
          status,
          plan,
          currentPeriodStart: new Date(subscription.current_period_start * 1000),
          currentPeriodEnd: new Date(subscription.current_period_end * 1000),
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
        },
      }),
    ]);
  }

  private inferPlanFromPrice(subscription: Stripe.Subscription): SubscriptionPlan {
    const priceId = subscription.items.data[0]?.price.id ?? '';
    if (priceId === env.STRIPE_PRICE_ENTERPRISE) return 'ENTERPRISE';
    if (priceId === env.STRIPE_PRICE_GROWTH) return 'GROWTH';
    return 'STARTER';
  }

  private mapStripeStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
    const map: Record<string, SubscriptionStatus> = {
      trialing: 'TRIALING',
      active: 'ACTIVE',
      past_due: 'PAST_DUE',
      canceled: 'CANCELED',
      unpaid: 'UNPAID',
      incomplete: 'PAST_DUE',
      incomplete_expired: 'CANCELED',
      paused: 'PAST_DUE',
    };
    return map[status] ?? 'ACTIVE';
  }
}
