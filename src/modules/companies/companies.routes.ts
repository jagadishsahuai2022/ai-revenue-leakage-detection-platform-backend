import { FastifyInstance } from 'fastify';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';
import { authenticate } from '../../shared/middleware/auth.middleware';
import { requireRole } from '../../shared/middleware/rbac.middleware';

export async function companiesRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new CompaniesService(fastify.prisma);
  const ctrl = new CompaniesController(service);

  const auth = { preHandler: [authenticate] };
  const adminAuth = { preHandler: [authenticate, requireRole('COMPANY_ADMIN')] };

  fastify.get('/', auth, (req, rep) => ctrl.get(req, rep));
  fastify.patch('/', adminAuth, (req, rep) => ctrl.update(req, rep));
  fastify.get('/stats', auth, (req, rep) => ctrl.stats(req, rep));

  // API Keys
  fastify.get('/api-keys', adminAuth, (req, rep) => ctrl.listApiKeys(req, rep));
  fastify.post('/api-keys', adminAuth, (req, rep) => ctrl.createApiKey(req, rep));
  fastify.delete('/api-keys/:keyId', adminAuth, (req, rep) => ctrl.revokeApiKey(req as any, rep));
}
