import { PrismaClient } from "@prisma/client";

// ── Demo fallback data ────────────────────────────────────────────────────────
function generateDemoActivity(companyId: string) {
  const now = Date.now();
  return [
    {
      id: "demo-a1",
      companyId,
      actorName: "Alice Chen",
      actorEmail: "alice@demo.com",
      action: "leakage.resolved",
      entityType: "Leakage",
      entityId: "L-4521",
      description: "Resolved duplicate billing entry — recovered $12,400",
      type: "user_action",
      createdAt: new Date(now - 300_000),
    },
    {
      id: "demo-a2",
      companyId,
      actorName: "System",
      action: "integration.sync.complete",
      entityType: "Integration",
      entityId: "stripe-1",
      description: "Stripe sync completed — 284 records processed",
      type: "integration",
      createdAt: new Date(now - 1_200_000),
    },
    {
      id: "demo-a3",
      companyId,
      actorName: "AI Engine",
      action: "ai.insight.generated",
      entityType: "AIInsight",
      description: "Detected 3 new revenue leakage patterns",
      type: "ai_insight",
      createdAt: new Date(now - 3_600_000),
    },
    {
      id: "demo-a4",
      companyId,
      actorName: "System",
      action: "system.health.degraded",
      description: "Database latency spike detected — 450ms average",
      type: "system_alert",
      createdAt: new Date(now - 7_200_000),
    },
    {
      id: "demo-a5",
      companyId,
      actorName: "Bob Smith",
      actorEmail: "bob@demo.com",
      action: "user.login",
      entityType: "Session",
      description: "Logged in via SSO",
      type: "user_action",
      createdAt: new Date(now - 10_800_000),
    },
    {
      id: "demo-a6",
      companyId,
      actorName: "Admin",
      actorEmail: "admin@demo.com",
      action: "settings.updated",
      entityType: "Settings",
      description: "Updated company notification preferences",
      type: "user_action",
      createdAt: new Date(now - 14_400_000),
    },
    {
      id: "demo-a7",
      companyId,
      actorName: "AI Engine",
      action: "ai.model.trained",
      entityType: "AIModel",
      description: "Monthly model retraining completed — 98.2% accuracy",
      type: "ai_insight",
      createdAt: new Date(now - 18_000_000),
    },
  ];
}

export async function listActivity(
  prisma: PrismaClient,
  companyId: string,
  limit = 20,
) {
  const rows = await prisma.activityLog.findMany({
    where: { companyId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  if (rows.length === 0) {
    return generateDemoActivity(companyId);
  }
  return rows;
}

export async function createActivity(
  prisma: PrismaClient,
  data: {
    companyId: string;
    actorId?: string;
    actorName?: string;
    actorEmail?: string;
    action: string;
    entityType?: string;
    entityId?: string;
    description?: string;
    type?: string;
  },
) {
  return prisma.activityLog.create({ data });
}
