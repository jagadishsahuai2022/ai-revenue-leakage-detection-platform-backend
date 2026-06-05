import { FastifyReply, FastifyRequest } from 'fastify';
import { BillingService } from './billing.service';
import { AppError } from '../../shared/errors/AppError';
import { successResponse } from '../../shared/utils/response';
import { z } from 'zod';
import { env } from '../../config/env';

const CheckoutSchema = z.object({
  plan: z.enum(['STARTER', 'GROWTH', 'ENTERPRISE']),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
});

const PortalSchema = z.object({
  returnUrl: z.string().url().optional(),
});

export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  async getSubscription(request: FastifyRequest, reply: FastifyReply) {
    const sub = await this.billingService.getSubscription(request.companyId);
    return reply.send(successResponse(sub));
  }

  async getInvoices(request: FastifyRequest, reply: FastifyReply) {
    const invoices = await this.billingService.getInvoices(request.companyId);
    return reply.send(successResponse(invoices));
  }

  async createCheckout(request: FastifyRequest, reply: FastifyReply) {
    const input = CheckoutSchema.parse(request.body);
    const successUrl = input.successUrl ?? `${env.FRONTEND_URL}/billing/success`;
    const cancelUrl = input.cancelUrl ?? `${env.FRONTEND_URL}/billing`;
    const session = await this.billingService.createCheckoutSession(
      request.companyId,
      input.plan,
      successUrl,
      cancelUrl,
    );
    return reply.send(successResponse(session));
  }

  async createPortal(request: FastifyRequest, reply: FastifyReply) {
    const input = PortalSchema.parse(request.body ?? {});
    const returnUrl = input.returnUrl ?? `${env.FRONTEND_URL}/billing`;
    const session = await this.billingService.createPortalSession(request.companyId, returnUrl);
    return reply.send(successResponse(session));
  }

  async webhook(request: FastifyRequest, reply: FastifyReply) {
    const signature = request.headers['stripe-signature'];
    if (!signature || typeof signature !== 'string') {
      throw AppError.badRequest('Missing Stripe-Signature header');
    }

    const rawBody = (request as any).rawBody as Buffer;
    await this.billingService.handleWebhook(rawBody, signature);
    return reply.status(200).send({ received: true });
  }
}
