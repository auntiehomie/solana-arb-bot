/**
 * P&L Aggregator — reads logs/trades.jsonl and generates daily/weekly reports.
 *
 * Usage:
 *   npx ts-node scripts/pnl-aggregator.ts                    # last 7 days
 *   npx ts-node scripts/pnl-aggregator.ts --days 30           # last 30 days
 *   npx ts-node scripts/pnl-aggregator.ts --since 2026-06-01  # custom date
 *   npx ts-node scripts/pnl-aggregator.ts --json              # JSON output
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';

const TRADES_FILE = path.join('logs', 'trades.jsonl');

interface AggregatedDay {
  date: string;
  totalTrades: number;
  executed: number;
  skipped: number;
  failed: number;
  grossProfitSOL: number;
  grossProfitUSD: number;
  netProfitSOL: number;
  netProfitUSD: number;
  totalFeeSOL: number;
  totalFeeUSD: number;
  bestTradeSOL: number;
  bestTradeUSD: number;
  worstTradeSOL: number;
  worstTradeUSD: number;
  avgProfitPct: number;
  winRate: number;
}

interface SummaryReport {
  periodStart: string;
  periodEnd: string;
  totalTrades: number;
  executedTrades: number;
  skippedTrades: number;
  failedTrades: number;
  grossProfitSOL: number;
  grossProfitUSD: number;
  netProfitSOL: number;
  netProfitUSD: number;
  totalFeesSOL: number;
  totalFeesUSD: number;
  winRate: number;
  avgProfitPct: number;
  bestTradeSOL: number;
  bestTradePair: string;
  worstTradeSOL: number;
  worstTradePair: string;
  daily: AggregatedDay[];
}

function parseArgs(): { since: Date; json: boolean } {
  const args = process.argv.slice(2);
  let days = 7;
  let since: Date | null = null;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--days' && args[i + 1]) {
      days = parseInt(args[++i], 10);
      if (isNaN(days) || days < 1) days = 7;
    } else if (args[i] === '--since' && args[i + 1]) {
      since = new Date(args[++i] + 'T00:00:00Z');
    } else if (args[i] === '--json') {
      json = true;
    }
  }

  if (!since) {
    since = new Date(Date.now() - days * 86400_000);
  }

  return { since, json };
}

function formatSOL(sol: number): string {
  return `${sol >= 0 ? '+' : ''}${sol.toFixed(6)} SOL`;
}

function formatUSD(usd: number): string {
  return `${usd >= 0 ? '+' : ''}$${usd.toFixed(2)}`;
}

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

function fmtPercent(pct: number): string {
  return `${(pct * 100).toFixed(2)}%`;
}

async function aggregate(from: Date): Promise<SummaryReport> {
  const filePath = path.resolve(TRADES_FILE);

  if (!fs.existsSync(filePath)) {
    return {
      periodStart: from.toISOString().slice(0, 10),
      periodEnd: new Date().toISOString().slice(0, 10),
      totalTrades: 0, executedTrades: 0, skippedTrades: 0, failedTrades: 0,
      grossProfitSOL: 0, grossProfitUSD: 0,
      netProfitSOL: 0, netProfitUSD: 0,
      totalFeesSOL: 0, totalFeesUSD: 0,
      winRate: 0, avgProfitPct: 0,
      bestTradeSOL: 0, bestTradePair: '',
      worstTradeSOL: 0, worstTradePair: '',
      daily: [],
    };
  }

  const fromMs = from.getTime();
  const now = new Date();

  const dailyMap = new Map<string, AggregatedDay>();
  let totalTrades = 0;
  let executedTrades = 0;
  let skippedTrades = 0;
  let failedTrades = 0;
  let grossProfitSOL = 0;
  let grossProfitUSD = 0;
  let netProfitSOL = 0;
  let netProfitUSD = 0;
  let totalFeesSOL = 0;
  let totalFeesUSD = 0;
  let winCount = 0;
  let lossCount = 0;
  let profitPctSum = 0;
  let profitPctCount = 0;
  let bestTradeSOL = -Infinity;
  let bestTradePair = '';
  let worstTradeSOL = Infinity;
  let worstTradePair = '';

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const entry = JSON.parse(trimmed);
      const ts = new Date(entry.timestamp);
      if (ts.getTime() < fromMs) continue;

      totalTrades++;
      const dateKey = formatDate(entry.timestamp);
      if (!dailyMap.has(dateKey)) {
        dailyMap.set(dateKey, {
          date: dateKey,
          totalTrades: 0, executed: 0, skipped: 0, failed: 0,
          grossProfitSOL: 0, grossProfitUSD: 0,
          netProfitSOL: 0, netProfitUSD: 0,
          totalFeeSOL: 0, totalFeeUSD: 0,
          bestTradeSOL: -Infinity, bestTradeUSD: -Infinity,
          worstTradeSOL: Infinity, worstTradeUSD: Infinity,
          avgProfitPct: 0, winRate: 0,
        });
      }
      const day = dailyMap.get(dateKey)!;
      day.totalTrades++;

      if (entry.executed) {
        executedTrades++;
        day.executed++;
        grossProfitSOL += entry.profitEstimateSOL || 0;
        grossProfitUSD += entry.profitEstimateUSD || 0;
        netProfitSOL += entry.netProfitSOL || 0;
        netProfitUSD += entry.netProfitUSD || 0;
        totalFeesSOL += entry.feeSOL || 0;
        totalFeesUSD += entry.feeUSD || 0;

        day.grossProfitSOL += entry.profitEstimateSOL || 0;
        day.grossProfitUSD += entry.profitEstimateUSD || 0;
        day.netProfitSOL += entry.netProfitSOL || 0;
        day.netProfitUSD += entry.netProfitUSD || 0;
        day.totalFeeSOL += entry.feeSOL || 0;
        day.totalFeeUSD += entry.feeUSD || 0;

        if ((entry.netProfitSOL ?? 0) > 0) {
          winCount++;
        } else {
          lossCount++;
        }

        if (entry.netProfitSOL !== undefined) {
          if (entry.netProfitSOL > bestTradeSOL) {
            bestTradeSOL = entry.netProfitSOL;
            bestTradePair = entry.pair || '';
          }
          if (entry.netProfitSOL < worstTradeSOL) {
            worstTradeSOL = entry.netProfitSOL;
            worstTradePair = entry.pair || '';
          }
          if (entry.netProfitSOL > (day.bestTradeSOL === -Infinity ? -Infinity : day.bestTradeSOL)) {
            day.bestTradeSOL = entry.netProfitSOL;
            day.bestTradeUSD = entry.netProfitUSD ?? 0;
          }
          if (entry.netProfitSOL < (day.worstTradeSOL === Infinity ? Infinity : day.worstTradeSOL)) {
            day.worstTradeSOL = entry.netProfitSOL;
            day.worstTradeUSD = entry.netProfitUSD ?? 0;
          }
        }

        if (entry.netProfitPct !== undefined) {
          profitPctSum += entry.netProfitPct;
          profitPctCount++;
        }
      } else if (entry.error) {
        failedTrades++;
        day.failed++;
      } else {
        skippedTrades++;
        day.skipped++;
      }
    } catch {
      // skip malformed lines
    }
  }

  // Fix -Infinity/Infinity defaults
  if (bestTradeSOL === -Infinity) {
    bestTradeSOL = 0;
    worstTradeSOL = 0;
  }
  if (worstTradeSOL === Infinity) worstTradeSOL = 0;

  const daily: AggregatedDay[] = Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, d]) => ({
      ...d,
      bestTradeSOL: d.bestTradeSOL === -Infinity ? 0 : d.bestTradeSOL,
      bestTradeUSD: d.bestTradeUSD === -Infinity ? 0 : d.bestTradeUSD,
      worstTradeSOL: d.worstTradeSOL === Infinity ? 0 : d.worstTradeSOL,
      worstTradeUSD: d.worstTradeUSD === Infinity ? 0 : d.worstTradeUSD,
      avgProfitPct: profitPctCount > 0 ? profitPctSum / profitPctCount : 0,
      winRate: (executedTrades > 0) ? winCount / executedTrades : 0,
    }));

  return {
    periodStart: from.toISOString().slice(0, 10),
    periodEnd: now.toISOString().slice(0, 10),
    totalTrades,
    executedTrades,
    skippedTrades,
    failedTrades,
    grossProfitSOL,
    grossProfitUSD,
    netProfitSOL,
    netProfitUSD,
    totalFeesSOL,
    totalFeesUSD,
    winRate: executedTrades > 0 ? winCount / executedTrades : 0,
    avgProfitPct: profitPctCount > 0 ? profitPctSum / profitPctCount : 0,
    bestTradeSOL,
    bestTradePair,
    worstTradeSOL,
    worstTradePair,
    daily,
  };
}

async function main() {
  const { since, json } = parseArgs();

  const report = await aggregate(since);

  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  // Pretty terminal output
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║        📊  ARB BOT  P&L  SUMMARY                        ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Period:  ${(report.periodStart + '          ').slice(0, 10)} → ${report.periodEnd}          ║`);
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Trades:  ${report.totalTrades.toString().padStart(5)} total  │ ${report.executedTrades.toString().padStart(3)} executed  │ ${report.skippedTrades.toString().padStart(3)} skipped  │ ${report.failedTrades.toString().padStart(3)} failed  ║`);
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Gross P&L:  ${formatSOL(report.grossProfitSOL).padStart(16)}  │  ${formatUSD(report.grossProfitUSD).padStart(10)}  ║`);
  console.log(`║  Net P&L:    ${formatSOL(report.netProfitSOL).padStart(16)}  │  ${formatUSD(report.netProfitUSD).padStart(10)}  ║`);
  console.log(`║  Total Fees: ${formatSOL(report.totalFeesSOL).padStart(16)}  │  ${formatUSD(report.totalFeesUSD).padStart(10)}  ║`);
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Win Rate:       ${(report.winRate * 100).toFixed(1).padStart(6)}%                                ║`);
  console.log(`║  Avg Profit %:   ${fmtPercent(report.avgProfitPct).padStart(6)}                                ║`);
  console.log(`║  Best Trade:     ${formatSOL(report.bestTradeSOL).padStart(16)}  (${report.bestTradePair})          ║`);
  console.log(`║  Worst Trade:    ${formatSOL(report.worstTradeSOL).padStart(16)}  (${report.worstTradePair})          ║`);
  console.log('╚══════════════════════════════════════════════════════════╝');

  if (report.daily.length > 0) {
    console.log('');
    console.log('Daily Breakdown:');
    console.log('───────────────');
    for (const day of report.daily) {
      const pnlStr = formatSOL(day.netProfitSOL);
      console.log(
        `  ${day.date}  │  ` +
        `🟢${day.executed}  ⏭${day.skipped}  ❌${day.failed}  │  ` +
        `PnL: ${pnlStr.padStart(14)}  │  ` +
        `Fees: ${formatSOL(day.totalFeeSOL).padStart(9)}  │  ` +
        `Win: ${(day.winRate * 100).toFixed(0).padStart(3)}%`
      );
    }
  }

  if (report.totalTrades === 0) {
    console.log('\n  ⚠️  No trade logs found in logs/trades.jsonl for this period.');
    console.log('     The bot needs to run and log trades before this report shows data.\n');
  }
}

main().catch((err) => {
  console.error('P&L aggregator failed:', err);
  process.exit(1);
});