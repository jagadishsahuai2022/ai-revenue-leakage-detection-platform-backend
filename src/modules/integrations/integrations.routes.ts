import { FastifyInstance } from 'fastify';
import { GitHubController } from './github/github.controller';
import { GitHubService } from './github/github.service';
import { ProvidersController } from './providers.controller';
import { CustomProvidersController } from './custom-providers.controller';
import { IconPresetsController } from './icon-presets.controller';
import { TestCredentialsController } from './test-credentials.controller';
import { EnterpriseIntegrationsController } from './enterprise-integrations.controller';
import { authenticate } from '../../shared/middleware/auth.middleware';
import { requireRole } from '../../shared/middleware/rbac.middleware';

export async function integrationsRoutes(fastify: FastifyInstance): Promise<void> {
  const githubService = new GitHubService(fastify.prisma);
  const githubCtrl = new GitHubController(githubService);
  const providersCtrl = new ProvidersController(fastify.prisma);
  const customCtrl = new CustomProvidersController(fastify.prisma);
  const iconPresetsCtrl = new IconPresetsController(fastify.prisma);
  const testCredsCtrl = new TestCredentialsController(fastify.prisma);
  const enterpriseCtrl = new EnterpriseIntegrationsController(fastify.prisma);

  const auth = { preHandler: [authenticate] };
  const adminAuth = { preHandler: [authenticate, requireRole('COMPANY_ADMIN')] };

  // ── Icon presets (public, no auth) ────────────────────────────────────────
  fastify.get('/icons/presets', (req, rep) => iconPresetsCtrl.listPresets(req, rep));

  // ── Enterprise Integration Endpoints ──────────────────────────────────────
  // These MUST be registered before `/providers/:provider` to avoid shadowing.

  // GET /integrations — list all connected integrations with health
  fastify.get('/', auth, (req, rep) => enterpriseCtrl.listIntegrations(req, rep));

  // GET /integrations/health — health dashboard
  fastify.get('/health', auth, (req, rep) => enterpriseCtrl.getHealthDashboard(req, rep));

  // POST /integrations/connect — connect a provider
  fastify.post('/connect', adminAuth, (req, rep) => enterpriseCtrl.connectProvider(req as any, rep));

  // GET /integrations/:id — get integration detail (must be after /health and /connect)
  fastify.get('/:id', auth, (req, rep) => enterpriseCtrl.getIntegration(req as any, rep));

  // POST /integrations/:id/disconnect — disconnect a provider
  fastify.post('/:id/disconnect', adminAuth, (req, rep) => enterpriseCtrl.disconnectProvider(req as any, rep));

  // POST /integrations/:id/sync — trigger manual sync
  fastify.post('/:id/sync', adminAuth, (req, rep) => enterpriseCtrl.triggerSync(req as any, rep));

  // GET /integrations/:id/logs — get integration audit logs
  fastify.get('/:id/logs', auth, (req, rep) => enterpriseCtrl.getIntegrationLogs(req as any, rep));

  // POST /integrations/:id/rotate — rotate credentials
  fastify.post('/:id/rotate', adminAuth, (req, rep) => enterpriseCtrl.rotateCredentials(req as any, rep));

  // ── Provider catalog ──────────────────────────────────────────────────────
  // /providers/custom must come BEFORE /providers/:provider to avoid shadowing
  fastify.get('/providers', auth, (req, rep) => providersCtrl.listProviders(req, rep));
  fastify.post('/providers/custom', adminAuth, (req, rep) => customCtrl.create(req, rep));
  fastify.post('/providers/custom/:id/ping', auth, (req, rep) => customCtrl.ping(req as any, rep));
  fastify.delete('/providers/custom/:id', adminAuth, (req, rep) => customCtrl.remove(req as any, rep));
  fastify.get('/providers/:provider', auth, (req, rep) => providersCtrl.getProviderStatus(req as any, rep));

  // ── Test credentials ──────────────────────────────────────────────────────
  // /test-credentials (list) must be before /test-credentials/:providerId
  fastify.get('/test-credentials', adminAuth, (req, rep) => testCredsCtrl.listAll(req, rep));
  fastify.get('/test-credentials/:providerId', auth, (req, rep) => testCredsCtrl.getOne(req as any, rep));
  fastify.put('/test-credentials/:providerId', adminAuth, (req, rep) => testCredsCtrl.upsert(req as any, rep));
  fastify.delete('/test-credentials/:providerId', adminAuth, (req, rep) => testCredsCtrl.remove(req as any, rep));

  // ── GitHub ────────────────────────────────────────────────────────────────
  fastify.get('/github/status', auth, (req, rep) => githubCtrl.status(req, rep));
  fastify.delete('/github', adminAuth, (req, rep) => githubCtrl.disconnect(req, rep));
  fastify.get('/github/repos', auth, (req, rep) => githubCtrl.listRepos(req, rep));
}
