/**
 * scripts/debug-ai-run.ts
 * Runs the full AI intelligence pipeline for a single company without
 * going through HTTP. Perfect for setting breakpoints in:
 *   - RunIntelligenceAnalysisUseCase
 *   - AIInsightGenerator
 *   - AnomalyDetector / ForecastEngine / RiskScoringEngine
 *
 * Usage:  npx tsx scripts/debug-ai-run.ts
 * Or:     COMPANY_ID=xxx npx tsx scripts/debug-ai-run.ts
 * Or run via VS Code "Debug AI Run Use Case" launch config (supports breakpoints).
 */
import { PrismaClient } from '@prisma/client';
import { RunIntelligenceAnalysisUseCase } from '../src/application/intelligence/RunIntelligenceAnalysisUseCase';

const prisma = new PrismaClient({ log: ['query', 'warn', 'error'] });

async function main() {
  // Pick which company to analyse
  let companyId = process.env.COMPANY_ID;
  if (!companyId) {
    const first = await prisma.company.findFirst({ select: { id: true, name: true } });
    if (!first) throw new Error('No companies found in database');
    companyId = first.id;
    console.log(`ℹ  No COMPANY_ID set — using: ${first.name} (${first.id})`);
  }

  // Count data points before running
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const revenueCount = await prisma.revenue.count({
    where: { companyId, period: { gte: since } },
  });
  console.log(`📅  Revenue rows in last 30 days: ${revenueCount}`);
  if (revenueCount < 5) {
    console.warn('⚠  Fewer than 5 data points — run scripts/seed-revenue.ts first for meaningful results');
  }

  // ── Run the use case directly (set breakpoints inside this →) ──
  const useCase = new RunIntelligenceAnalysisUseCase(prisma);
  const result = await useCase.execute({
    companyId,
    lookbackDays: 30,
    // zScoreThreshold: 2.0,  // uncomment to lower sensitivity
  });

  // ── Print result summary ──
  console.log('\n✅  Result:');
  console.log(`   insightId    : ${result.insightId}`);
  console.log(`   sufficient   : ${result.sufficient}`);
  console.log(`   riskScore    : ${result.insight.riskScore.score} (${result.insight.riskScore.level})`);
  console.log(`   anomalyCount : ${result.insight.anomalyReport.anomalyCount}`);
  console.log(`   trend        : ${result.insight.forecastReport.trend}`);
  console.log(`   dataPoints   : ${result.insight.dataPoints}`);
  console.log(`   windowStart  : ${result.insight.windowStart}`);
  console.log(`   windowEnd    : ${result.insight.windowEnd}`);
  if (result.insight.anomalyReport.anomalyCount > 0) {
    console.log('\n   Top anomalies:');
    for (const a of result.insight.anomalyReport.anomalies.slice(0, 5)) {
      const ts = new Date(a.timestamp).toISOString().split('T')[0];
      console.log(`     ${ts}  $${Number(a.value).toFixed(2)}  z=${Number(a.zScore).toFixed(2)}`);
    }
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
