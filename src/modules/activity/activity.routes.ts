import { FastifyInstance } from "fastify";
import { authenticate } from "../../shared/middleware/auth.middleware";
import { successResponse } from "../../shared/utils/response";
import { listActivity } from "./activity.service";

export async function activityRoutes(fastify: FastifyInstance): Promise<void> {
  const authHook = { preHandler: [authenticate] };

  /** GET /activity — recent activity timeline for current company */
  fastify.get<{ Querystring: { limit?: string } }>(
    "/",
    authHook,
    async (req, reply) => {
      const limit = req.query.limit ? parseInt(req.query.limit, 10) : 20;
      const data = await listActivity(req.server.prisma, req.companyId, limit);
      return reply.send(successResponse(data));
    },
  );
}
