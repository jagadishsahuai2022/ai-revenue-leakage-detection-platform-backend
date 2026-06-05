import { FastifyInstance } from 'fastify';
import { RevenueController } from './revenue.controller';
import { RevenueService } from './revenue.service';
import { authenticate } from '../../shared/middleware/auth.middleware';
import { requireRole } from '../../shared/middleware/rbac.middleware';

export async function revenueRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new RevenueService(fastify.prisma);
  const ctrl = new RevenueController(service);

  const auth = { preHandler: [authenticate] };
  const analystAuth = { preHandler: [authenticate, requireRole('ANALYST')] };
  const adminAuth = { preHandler: [authenticate, requireRole('COMPANY_ADMIN')] };

  // Analytics (read-only, all authenticated users)
  fastify.get('/analytics', auth, (req, rep) => ctrl.getAnalytics(req as any, rep));

  // Revenue records
  fastify.get('/', auth, (req, rep) => ctrl.listRevenue(req as any, rep));
  fastify.get('/:revenueId', auth, (req, rep) => ctrl.getRevenue(req as any, rep));
  fastify.post('/', analystAuth, (req, rep) => ctrl.createRevenue(req, rep));
  fastify.patch('/:revenueId', analystAuth, (req, rep) => ctrl.updateRevenue(req as any, rep));
  fastify.delete('/:revenueId', adminAuth, (req, rep) => ctrl.deleteRevenue(req as any, rep));

  // Leakages
  fastify.get('/leakages', auth, (req, rep) => ctrl.listLeakages(req as any, rep));
  fastify.post('/leakages', analystAuth, (req, rep) => ctrl.createLeakage(req, rep));
  fastify.post('/leakages/:leakageId/resolve', analystAuth, (req, rep) => ctrl.resolveLeakage(req as any, rep));
  fastify.delete('/leakages/:leakageId', adminAuth, (req, rep) => ctrl.deleteLeakage(req as any, rep));
}
