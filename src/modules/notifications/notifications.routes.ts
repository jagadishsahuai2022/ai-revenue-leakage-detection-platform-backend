import { FastifyInstance } from "fastify";
import { authenticate } from "../../shared/middleware/auth.middleware";
import { successResponse } from "../../shared/utils/response";
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "./notifications.service";

export async function notificationsRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  const authHook = { preHandler: [authenticate] };

  /** GET /notifications — list notifications for current company */
  fastify.get<{ Querystring: { limit?: string } }>(
    "/",
    authHook,
    async (req, reply) => {
      const limit = req.query.limit ? parseInt(req.query.limit, 10) : 30;
      const data = await listNotifications(
        req.server.prisma,
        req.companyId,
        limit,
      );
      return reply.send(successResponse(data));
    },
  );

  /** PUT /notifications/:id/read — mark one notification as read */
  fastify.put<{ Params: { id: string } }>(
    "/:id/read",
    authHook,
    async (req, reply) => {
      await markNotificationRead(
        req.server.prisma,
        req.params.id,
        req.companyId,
      );
      return reply.send(successResponse({ success: true }));
    },
  );

  /** PUT /notifications/read-all — mark all notifications as read */
  fastify.put("/read-all", authHook, async (req, reply) => {
    await markAllNotificationsRead(req.server.prisma, req.companyId);
    return reply.send(successResponse({ success: true }));
  });
}
