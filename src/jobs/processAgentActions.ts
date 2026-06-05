// ─────────────────────────────────────────────────────────────────────────────
// Process Agent Actions — Cron Job
//
// A cron-friendly, zero-infrastructure background job that:
//   1. Queries all APPROVED AgentActionProposals across all tenants
//   2. Passes each through AIPolicyEngine one final time (pre-execution gate)
//   3. Executes via ActionConnectorAdapter
//   4. Writes immutable AgentExecutionLog & updates proposal status
//   5. Records per-run metrics into AgentExecutionMetrics
//
// Run via:
//   npx tsx src/jobs/processAgentActions.ts
//   — or —
//   npm run job:process-agent-actions
//
// Schedule with Render Cron Jobs, Railway Cron, or OS-level cron.
// No Redis, no BullMQ, no external queues required.
// ─────────────────────────────────────────────────────────────────────────────

import { PrismaClient, Prisma } from "@prisma/client";
import pino from "pino";
import { env } from "../config/env";
import { AIPolicyEngine } from "../modules/agent/domain/policies/AIPolicyEngine";
import { ExecutionPolicy } from "../modules/agent/domain/policies/ExecutionPolicy";
import { ActionConnectorAdapter } from "../modules/agent/infrastructure/connectors/ActionConnectorAdapter";
import { DoubleApprovalService } from "../modules/agent/application/services/DoubleApprovalService";
import { ActionType } from "../modules/agent/domain/enums/ActionType";
import { ProposalStatus } from "../modules/agent/domain/enums/ProposalStatus";
import { startupJitter } from "../shared/utils/jitter";

const log = pino({ name: "process-agent-actions", level: env.LOG_LEVEL });

/** Maximum proposals to process per cron run (prevents runaway execution) */
const BATCH_SIZE = 50;

/** Maximum age in hours for approved proposals — older ones get cancelled */
const MAX_APPROVED_AGE_HOURS = 72;

interface RunMetrics {
  totalProcessed: number;
  successes: number;
  failures: number;
  skipped: number;
  cancelled: number;
  totalDurationMs: number;
}

async function processAgentActions(): Promise<void> {
  const prisma = new PrismaClient();
  const startTime = Date.now();
  const metrics: RunMetrics = {
    totalProcessed: 0,
    successes: 0,
    failures: 0,
    skipped: 0,
    cancelled: 0,
    totalDurationMs: 0,
  };

  try {
    // Stagger startup so multiple cron replicas don't hammer the DB simultaneously
    const staggerMs = await startupJitter(15_000);
    log.info(
      { staggerMs },
      "Startup jitter applied — beginning agent action processing",
    );

    // ── 1. Cancel stale approved proposals ─────────────────────────────────
    const staleThreshold = new Date(
      Date.now() - MAX_APPROVED_AGE_HOURS * 60 * 60 * 1000,
    );
    const { count: cancelledCount } =
      await prisma.agentActionProposal.updateMany({
        where: {
          status: ProposalStatus.APPROVED,
          approvedAt: { lt: staleThreshold },
        },
        data: { status: ProposalStatus.CANCELLED },
      });
    if (cancelledCount > 0) {
      log.info(
        { cancelledCount, maxAgeHours: MAX_APPROVED_AGE_HOURS },
        "Cancelled stale approved proposals",
      );
      metrics.cancelled = cancelledCount;
    }

    // ── 2. Fetch batch of APPROVED proposals ───────────────────────────────
    const proposals = await prisma.agentActionProposal.findMany({
      where: { status: ProposalStatus.APPROVED },
      orderBy: [
        { priorityScore: "desc" }, // Highest priority first
        { approvedAt: "asc" }, // Oldest approval first (FIFO within priority)
      ],
      take: BATCH_SIZE,
    });

    log.info(
      { count: proposals.length },
      `Found ${proposals.length} approved proposal(s) to process`,
    );

    if (proposals.length === 0) {
      log.info("No approved proposals to process. Exiting.");
      metrics.totalDurationMs = Date.now() - startTime;
      await recordMetrics(prisma, metrics);
      return;
    }

    const connector = new ActionConnectorAdapter(prisma);
    const engine = new AIPolicyEngine();
    const doubleApprovalSvc = new DoubleApprovalService(prisma);

    // ── 3. Process each proposal ───────────────────────────────────────────
    for (const proposal of proposals) {
      const proposalLabel = `${proposal.actionType}/${proposal.id}`;
      const proposalStart = Date.now();
      metrics.totalProcessed++;

      try {
        // 3a. Pre-execution policy gate (final safety check)
        const violations = ExecutionPolicy.validateForExecution({
          status: proposal.status as ProposalStatus,
          confidenceScore: proposal.confidenceScore,
          estimatedImpact: proposal.estimatedImpact,
          actionType: proposal.actionType as ActionType,
          requiresApproval: proposal.requiresApproval,
        });

        if (violations.length > 0) {
          log.warn(
            {
              proposalId: proposal.id,
              violations: violations.map((v) => v.reason),
            },
            `Skipping ${proposalLabel} — policy violations`,
          );
          metrics.skipped++;
          continue;
        }

        // 3b. AI Policy Engine gate
        const policyCtx = await AIPolicyEngine.buildContext(prisma, {
          companyId: proposal.companyId,
          actionType: proposal.actionType,
          estimatedImpact: proposal.estimatedImpact,
          confidenceScore: proposal.confidenceScore,
        });

        const evaluation = engine.evaluate(policyCtx);

        if (evaluation.verdict === "DENY") {
          log.warn(
            { proposalId: proposal.id, reasons: evaluation.reasons },
            `Denied by policy: ${proposalLabel}`,
          );
          await prisma.agentActionProposal.update({
            where: { id: proposal.id },
            data: { status: ProposalStatus.CANCELLED },
          });
          metrics.skipped++;
          continue;
        }

        // 3c. Double-approval check for high-risk actions
        if (evaluation.requireDoubleApproval) {
          const isFullyApproved = await doubleApprovalSvc.isFullyApproved(
            proposal.id,
          );
          if (!isFullyApproved) {
            log.info(
              { proposalId: proposal.id },
              `Skipping ${proposalLabel} — awaiting double approval`,
            );
            metrics.skipped++;
            continue;
          }
        }

        // 3d. Execute the action
        let execStatus: "SUCCESS" | "FAILED" = "FAILED";
        let result: Record<string, unknown> | null = null;
        let errorMessage: string | null = null;

        try {
          result = await connector.dispatch(
            proposal.actionType as ActionType,
            proposal.payload as Record<string, unknown>,
            proposal.companyId,
          );
          execStatus = "SUCCESS";
        } catch (err) {
          errorMessage = err instanceof Error ? err.message : String(err);
          log.error(
            { proposalId: proposal.id, error: errorMessage },
            `Dispatch failed: ${proposalLabel}`,
          );
        }

        const durationMs = Date.now() - proposalStart;

        // 3e. Write immutable execution log
        await prisma.agentExecutionLog.create({
          data: {
            companyId: proposal.companyId,
            proposalId: proposal.id,
            executionType: proposal.actionType,
            payload: proposal.payload as object,
            result:
              result !== null
                ? (result as Prisma.InputJsonValue)
                : Prisma.JsonNull,
            status: execStatus,
            errorMessage,
            durationMs,
          },
        });

        // 3f. Update proposal status
        const finalStatus =
          execStatus === "SUCCESS"
            ? ProposalStatus.EXECUTED
            : ProposalStatus.FAILED;

        await prisma.agentActionProposal.update({
          where: { id: proposal.id },
          data: {
            status: finalStatus,
            executedAt: new Date(),
          },
        });

        if (execStatus === "SUCCESS") {
          metrics.successes++;
          log.info(
            { proposalId: proposal.id, durationMs },
            `Executed OK: ${proposalLabel} (${durationMs}ms)`,
          );
        } else {
          metrics.failures++;
          log.error(
            { proposalId: proposal.id, error: errorMessage, durationMs },
            `Executed FAIL: ${proposalLabel}`,
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error(
          { proposalId: proposal.id, error: msg },
          `Unhandled error processing ${proposalLabel}`,
        );
        metrics.failures++;
      }
    }

    metrics.totalDurationMs = Date.now() - startTime;
    await recordMetrics(prisma, metrics);

    log.info(
      {
        ...metrics,
      },
      `Agent action processing complete: ${metrics.successes} OK, ${metrics.failures} failed, ${metrics.skipped} skipped, ${metrics.cancelled} cancelled`,
    );

    if (metrics.failures > 0) {
      process.exitCode = 1;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.fatal({ error: msg }, "Process agent actions job crashed");
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Record execution metrics for this run into ag_execution_metrics table.
 * Non-fatal — if the table doesn't exist yet, log and continue.
 */
async function recordMetrics(
  prisma: PrismaClient,
  metrics: RunMetrics,
): Promise<void> {
  try {
    await prisma.agentExecutionMetrics.create({
      data: {
        runAt: new Date(),
        totalProcessed: metrics.totalProcessed,
        successes: metrics.successes,
        failures: metrics.failures,
        skipped: metrics.skipped,
        cancelled: metrics.cancelled,
        totalDurationMs: metrics.totalDurationMs,
        avgDurationMs:
          metrics.totalProcessed > 0
            ? Math.round(metrics.totalDurationMs / metrics.totalProcessed)
            : 0,
      },
    });
  } catch (err) {
    log.warn(
      { err },
      "Failed to record execution metrics — table may not exist yet",
    );
  }
}

// ── Execute ──────────────────────────────────────────────────────────────────
processAgentActions();
