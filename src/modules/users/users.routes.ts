import { FastifyInstance } from 'fastify';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { authenticate } from '../../shared/middleware/auth.middleware';
import { requireRole } from '../../shared/middleware/rbac.middleware';
import { getUserPreferences, updateUserPreferences } from './user-preferences.service';
import { successResponse } from '../../shared/utils/response';
import { AppError } from '../../shared/errors/AppError';

export async function usersRoutes(fastify: FastifyInstance): Promise<void> {
  const usersService = new UsersService(fastify.prisma);
  const ctrl = new UsersController(usersService);

  const authHook = { preHandler: [authenticate] };
  const adminHook = { preHandler: [authenticate, requireRole('COMPANY_ADMIN')] };

  // Profile (current user)
  fastify.get('/me', authHook, (req, rep) => ctrl.updateMe(req, rep));
  fastify.patch('/me', authHook, (req, rep) => ctrl.updateMe(req, rep));
  fastify.post('/me/change-password', authHook, (req, rep) => ctrl.changePassword(req, rep));

  // ── User Preferences (/me/preferences must be registered before /:userId) ──
  fastify.get('/me/preferences', authHook, async (req, reply) => {
    const prefs = await getUserPreferences(req.server.prisma, req.userId);
    return reply.send(successResponse(prefs));
  });

  fastify.patch<{ Body: { theme?: string } }>(
    '/me/preferences',
    authHook,
    async (req, reply) => {
      const { theme } = req.body ?? {};
      if (theme !== undefined && typeof theme !== 'string') {
        throw AppError.badRequest('theme must be a string');
      }
      const prefs = await updateUserPreferences(req.server.prisma, req.userId, { theme: theme as any });
      return reply.send(successResponse(prefs));
    },
  );

  // Team management (admin only)
  fastify.get('/', adminHook, (req, rep) => ctrl.list(req as any, rep));
  fastify.post('/invite', adminHook, (req, rep) => ctrl.invite(req, rep));
  fastify.get('/:userId', adminHook, (req, rep) => ctrl.getOne(req as any, rep));
  fastify.patch('/:userId/role', adminHook, (req, rep) => ctrl.updateRole(req as any, rep));
  fastify.delete('/:userId', adminHook, (req, rep) => ctrl.deactivate(req as any, rep));
}
