import { FastifyInstance } from 'fastify';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { authenticate } from '../../shared/middleware/auth.middleware';
import { requireRole } from '../../shared/middleware/rbac.middleware';
import { addContentTypeParser } from './raw-body.helper';

export async function billingRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new BillingService(fastify.prisma);
  const ctrl = new BillingController(service);

  const adminAuth = { preHandler: [authenticate, requireRole('COMPANY_ADMIN')] };
  const auth = { preHandler: [authenticate] };

  // Stripe webhook – raw body needed before JSON parsing
  fastify.post('/webhook', {
    config: { rawBody: true },
  }, (req, rep) => ctrl.webhook(req, rep));

  fastify.get('/subscription', auth, (req, rep) => ctrl.getSubscription(req, rep));
  fastify.get('/invoices', auth, (req, rep) => ctrl.getInvoices(req, rep));
  fastify.post('/checkout', adminAuth, (req, rep) => ctrl.createCheckout(req, rep));
  fastify.post('/portal', adminAuth, (req, rep) => ctrl.createPortal(req, rep));
}
