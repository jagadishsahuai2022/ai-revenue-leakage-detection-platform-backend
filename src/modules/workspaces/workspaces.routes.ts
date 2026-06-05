import { FastifyInstance } from "fastify";
import { authenticate } from "../../shared/middleware/auth.middleware";
import { successResponse } from "../../shared/utils/response";
import { AppError } from "../../shared/errors/AppError";
import { listWorkspaces, switchWorkspace } from "./workspaces.service";

export async function workspacesRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  const authHook = { preHandler: [authenticate] };

  /** GET /workspaces — list workspaces accessible to current user */
  fastify.get("/", authHook, async (req, reply) => {
    const data = await listWorkspaces(req.server.prisma, req.userId);
    return reply.send(successResponse(data));
  });

  /** POST /workspaces/:id/switch — switch active workspace */
  fastify.post<{ Params: { id: string } }>(
    "/:id/switch",
    authHook,
    async (req, reply) => {
      try {
        const workspace = await switchWorkspace(
          req.server.prisma,
          req.userId,
          req.params.id,
        );
        return reply.send(successResponse(workspace));
      } catch (e: any) {
        throw AppError.badRequest(e.message ?? "Failed to switch workspace");
      }
    },
  );
}
