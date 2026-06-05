import { PrismaClient } from "@prisma/client";

/**
 * List workspaces (companies) accessible to the current user.
 * Currently a user belongs to exactly one company, but the API
 * is multi-workspace-ready for future expansion.
 */
export async function listWorkspaces(prisma: PrismaClient, userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      company: { select: { id: true, name: true, slug: true, plan: true } },
    },
  });

  if (!user) return [];
  return [user.company];
}

/**
 * Switch active workspace. In the current single-company model this is a no-op
 * that validates the company exists. When multi-workspace lands, this will
 * update the user's active workspace and reissue a JWT.
 */
export async function switchWorkspace(
  prisma: PrismaClient,
  userId: string,
  targetCompanyId: string,
) {
  const company = await prisma.company.findUnique({
    where: { id: targetCompanyId },
    select: { id: true, name: true, slug: true, plan: true },
  });

  if (!company) {
    throw new Error("Workspace not found");
  }

  // In future: update user.activeCompanyId and reissue JWT
  return company;
}
