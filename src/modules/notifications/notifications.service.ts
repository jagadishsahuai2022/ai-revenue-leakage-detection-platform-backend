import { PrismaClient } from "@prisma/client";

// ── Demo fallback data ────────────────────────────────────────────────────────
function generateDemoNotifications(companyId: string) {
  const now = Date.now();
  return [
    {
      id: "demo-n1",
      companyId,
      type: "ai_insight",
      title: "New leakage pattern detected",
      message: "3 duplicate billing entries found in recent transactions.",
      severity: "warning",
      isRead: false,
      actionUrl: "/leakages",
      createdAt: new Date(now - 300_000),
    },
    {
      id: "demo-n2",
      companyId,
      type: "alert",
      title: "High risk score alert",
      message: "Account #4521 risk score exceeded threshold.",
      severity: "critical",
      isRead: false,
      actionUrl: "/dashboard",
      createdAt: new Date(now - 1_200_000),
    },
    {
      id: "demo-n3",
      companyId,
      type: "system",
      title: "Integration sync complete",
      message: "Stripe integration synced 284 records.",
      severity: "info",
      isRead: true,
      actionUrl: null,
      createdAt: new Date(now - 3_600_000),
    },
    {
      id: "demo-n4",
      companyId,
      type: "info",
      title: "Welcome to RevSecure",
      message: "Get started by connecting your first integration.",
      severity: "info",
      isRead: true,
      actionUrl: "/integrations",
      createdAt: new Date(now - 86_400_000),
    },
  ];
}

export async function listNotifications(
  prisma: PrismaClient,
  companyId: string,
  limit = 30,
) {
  const rows = await prisma.notification.findMany({
    where: { companyId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  if (rows.length === 0) {
    return generateDemoNotifications(companyId);
  }
  return rows;
}

export async function markNotificationRead(
  prisma: PrismaClient,
  id: string,
  companyId: string,
) {
  // Safety: only update within the caller's company
  return prisma.notification.updateMany({
    where: { id, companyId },
    data: { isRead: true },
  });
}

export async function markAllNotificationsRead(
  prisma: PrismaClient,
  companyId: string,
) {
  return prisma.notification.updateMany({
    where: { companyId, isRead: false },
    data: { isRead: true },
  });
}

export async function createNotification(
  prisma: PrismaClient,
  data: {
    companyId: string;
    type: string;
    title: string;
    message?: string;
    severity?: string;
    actionUrl?: string;
    userId?: string;
  },
) {
  return prisma.notification.create({ data });
}
