import { FastifyInstance } from 'fastify';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { authenticate } from '../../shared/middleware/auth.middleware';

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  const authService = new AuthService(fastify.prisma, fastify);
  const ctrl = new AuthController(authService);

  // Bind methods to preserve `this`
  fastify.post('/register', (req, rep) => ctrl.register(req, rep));
  fastify.post('/login', (req, rep) => ctrl.login(req, rep));
  fastify.post('/refresh', (req, rep) => ctrl.refresh(req, rep));
  fastify.post('/logout', (req, rep) => ctrl.logout(req, rep));

  // Protected
  fastify.get('/me', { preHandler: [authenticate] }, (req, rep) => ctrl.me(req, rep));

  // GitHub OAuth
  fastify.get('/github', (req, rep) => ctrl.githubRedirect(req, rep));
  fastify.get('/github/callback', (req, rep) => ctrl.githubCallback(req as any, rep));
}
