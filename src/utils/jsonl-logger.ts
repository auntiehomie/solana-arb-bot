/**
 * Structured JSONL trade logger.
 *
 * Writes one JSON object per line to logs/trades.jsonl for analytics,
 * P&L tracking, and debugging. Each trade attempt is recorded with
 * timestamp, pair data, fees, execution status, and error details.
 *
 * Usage:
 *   import { logTradeAttempt } from './utils/jsonl-logger';
 *   logTradeAttempt({ pair: 'SOL/USDC', profitEstimateSOL: 0.01, ... });
 *
 * File format: NDJSON (newline-delimited JSON) — one row per line.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ensureDir } from './fs-utils';

const LOG_DIR = 'logs';
const TRADES_FILE = path.join(LOG_DIR, 'trades.jsonl');

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface TradeLogEntry {
  /** ISO-8601 UTC timestamp */
  timestamp: string;
  /** Trading pair symbol, e.g. 'SOL/USDC' */
  pair: string;
  /** Token symbols involved */
  tokenSymbol: string;
  /** Profit estimate in SOL before fees */
  profitEstimateSOL: number;
  /** Profit estimate in USD before fees */
  profitEstimateUSD: number;
  /** Net profit estimate after fees in SOL */
  netProfitSOL: number;
  /** Net profit estimate after fees in USD */
  netProfitUSD: number;
  /** Fee cost in SOL */
  feeSOL: number;
  /** Fee cost in USD */
  feeUSD: number;
  /** Whether the trade was executed */
  executed: boolean;
  /** Transaction signature(s) if executed */
  txHash?: string;
  /** Leg 1 signature */
  leg1Sig?: string;
  /** Leg 2 signature */
  leg2Sig?: string;
  /** Error message if any */
  error?: string;
  /** Whether this was a dry run */
  dryRun: boolean;
  /** Route description */
  route?: string;
  /** Profit percentage (gross) */
  profitPct?: number;
  /** Net profit percentage after fees */
  netProfitPct?: number;
}

// ─── Logger ────────────────────────────────────────────────────────────────────

/**
 * Format a timestamp as ISO-8601 without milliseconds for readability.
 */
function nowISO(): string {
  return new Date().toISOString();
}

/**
 * Write one trade event to the JSONL log file.
 *
 * Creates the logs/ directory on first call if it doesn't exist.
 * Appends one line per call — safe for concurrent usage from async paths.
 *
 * @param entry - Structured trade log entry
 */
export function logTradeAttempt(entry: TradeLogEntry): void {
  try {
    ensureDir(LOG_DIR);
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(TRADES_FILE, line, 'utf-8');
  } catch (err) {
    // Silently fail — we don't want logging errors to crash the bot
    // In production this should go to a side-channel like stderr
    process.stderr.write(`[jsonl-logger] Failed to write trade log: ${(err as Error).message}\n`);
  }
}

// ─── Convenience wrappers ──────────────────────────────────────────────────────

/**
 * Log a trade attempt (before execution).
 */
export function logTradeAttemptStart(
  tokenSymbol: string,
  inputAmount: bigint,
  outputAmount: bigint,
  profitAmount: bigint,
  profitPct: number,
  profitUsd: number,
  netProfitSOL: number,
  netProfitUSD: number,
  feeSOL: number,
  feeUSD: number,
  dryRun: boolean,
  route?: string,
): void {
  logTradeAttempt({
    timestamp: nowISO(),
    pair: `${tokenSymbol}/...`,
    tokenSymbol,
    profitEstimateSOL: Number(profitAmount) / 1e9,
    profitEstimateUSD: profitUsd,
    netProfitSOL,
    netProfitUSD,
    feeSOL,
    feeUSD,
    executed: false,
    dryRun,
    profitPct,
    netProfitPct: profitPct, // approximate
    route,
  });
}

/**
 * Log a completed (or failed) trade execution.
 */
export function logTradeResult(
  tokenSymbol: string,
  inputAmount: bigint,
  outputAmount: bigint,
  profitAmount: bigint,
  profitPct: number,
  profitUsd: number,
  netProfitSOL: number,
  netProfitUSD: number,
  feeSOL: number,
  feeUSD: number,
  executed: boolean,
  dryRun: boolean,
  route: string | undefined,
  leg1Sig?: string,
  leg2Sig?: string,
  error?: string,
): void {
  logTradeAttempt({
    timestamp: nowISO(),
    pair: `${tokenSymbol}/...`,
    tokenSymbol,
    profitEstimateSOL: Number(profitAmount) / 1e9,
    profitEstimateUSD: profitUsd,
    netProfitSOL,
    netProfitUSD,
    feeSOL,
    feeUSD,
    executed,
    txHash: leg1Sig || leg2Sig ? `${leg1Sig ?? ''},${leg2Sig ?? ''}` : undefined,
    leg1Sig,
    leg2Sig,
    error,
    dryRun,
    profitPct,
    netProfitPct: profitPct,
    route,
  });
}