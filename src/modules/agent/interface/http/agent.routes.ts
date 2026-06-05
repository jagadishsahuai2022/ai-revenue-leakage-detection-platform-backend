// ── Agent routes ──────────────────────────────────────────────────────────────
// Registered in app.ts under `${prefix}/agent`.
//
//  POST   /agent/plan                               → trigger planning for an insightId
//  GET    /agent/proposals                          → list proposals
//  POST   /agent/proposals/:id/approve              → COMPANY_ADMIN only
//  POST   /agent/proposals/:id/reject               → COMPANY_ADMIN only
//  POST   /agent/proposals/:id/execute              → COMPANY_ADMIN only (202 for high-risk)
//  GET    /agent/proposals/:id/execution-logs       → execution log for a proposal
//  GET    /agent/approvals/:approvalId              → double-approval status
//  POST   /agent/approvals/:approvalId/approve      → submit one approval step
//  POST   /agent/approvals/:approvalId/reject       → reject double-approval
//  GET    /agent/analytics                          → execution analytics
//  GET    /agent/executions                         → execution history
//  GET    /agent/policies                           → policy config
//  PUT    /agent/policies                           → update policy config

import { FastifyInstance } from "fastify";
import { authenticate } from "../../../../shared/middleware/auth.middleware";
import { requireRole } from "../../../../shared/middleware/rbac.middleware";
import { AgentController } from "./agent.controller";

export async function agentRoutes(fastify: FastifyInstance): Promise<void> {
  const ctrl = new AgentController(fastify.prisma);

  const auth = { preHandler: [authenticate] };
  const adminAuth = {
    preHandler: [authenticate, requireRole("COMPANY_ADMIN")],
  };

  // ── Planning ──────────────────────────────────────────────────────────────
  fastify.post("/plan", adminAuth, (req, rep) => ctrl.planForInsight(req, rep));

  // ── Read proposals ────────────────────────────────────────────────────────
  fastify.get("/proposals", auth, (req, rep) => ctrl.listProposals(req, rep));

  // ── Single-approval workflow (COMPANY_ADMIN only) ─────────────────────────
  fastify.post("/proposals/:id/approve", adminAuth, (req, rep) =>
    ctrl.approveProposal(req as any, rep),
  );
  fastify.post("/proposals/:id/reject", adminAuth, (req, rep) =>
    ctrl.rejectProposal(req as any, rep),
  );

  // ── Execution (COMPANY_ADMIN only) — may return 202 for high-risk ─────────
  fastify.post("/proposals/:id/execute", adminAuth, (req, rep) =>
    ctrl.executeProposal(req as any, rep),
  );

  // ── Execution logs ────────────────────────────────────────────────────────
  fastify.get("/proposals/:id/execution-logs", auth, (req, rep) =>
    ctrl.getExecutionLogs(req as any, rep),
  );

  // ── Maintenance ───────────────────────────────────────────────────────────
  fastify.post("/proposals/cleanup", adminAuth, (req, rep) =>
    ctrl.cleanupDuplicates(req, rep),
  );

  // ── Double-approval workflow (COMPANY_ADMIN only) ─────────────────────────
  fastify.get("/approvals/:approvalId", adminAuth, (req, rep) =>
    ctrl.getDoubleApprovalStatus(req as any, rep),
  );
  fastify.post("/approvals/:approvalId/approve", adminAuth, (req, rep) =>
    ctrl.submitDoubleApproval(req as any, rep),
  );
  fastify.post("/approvals/:approvalId/reject", adminAuth, (req, rep) =>
    ctrl.rejectDoubleApproval(req as any, rep),
  );

  // ── Dashboard / Analytics (all authenticated users) ───────────────────────
  fastify.get("/metrics", auth, (req, rep) => ctrl.getMetrics(req, rep));
  fastify.get("/executions", auth, (req, rep) => ctrl.getExecutions(req, rep));
  fastify.get("/summary", auth, (req, rep) => ctrl.getSummary(req, rep));
  fastify.get("/analytics", auth, (req, rep) => ctrl.getAnalytics(req, rep));

  // ── Policy Configuration (COMPANY_ADMIN only) ─────────────────────────────
  fastify.get("/policies", adminAuth, (req, rep) => ctrl.getPolicies(req, rep));
  fastify.put("/policies", adminAuth, (req, rep) =>
    ctrl.updatePolicies(req, rep),
  );
}
