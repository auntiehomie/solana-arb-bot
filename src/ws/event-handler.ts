/**
 * Event handler for pool account changes.
 *
 * Debounces rapid pool updates, then immediately fetches Jupiter
 * round-trip quotes and executes if profitable.
 *
 * Latency path:
 *   pool swap → Helius WS fires (~20ms) → debounce (50ms) → Jupiter quote (~150ms) → execute (~100ms)
 *   Total: ~320ms — vs 600ms+ polling
 */

import { Connection, Keypair } from '@solana/web3.js';
import axios from 'axios';
import { PoolAccount } from './pool-watcher';
import { Config } from '../config';
import { logger } from '../utils/logger';
import { executeCircular } from '../executor/direct';
import { CircularOpportunity } from '../scanner/circular';
import { recoverStrandedTokens } from '../executor/recovery';
import { getUsdPrices } from '../utils/prices';
import { TOKENS } from '../types';
import { routeHasExoticDex } from '../utils/dex-blocklist';
import { calcNetProfit, feeFloorPct } from '../utils/fees';

const QUOTE_URL_PRO  = 'https://api.jup.ag/swap/v1/quote';
const QUOTE_URL_LITE = 'https://lite-api.jup.ag/swap/v1/quote';

function getQuoteUrl(cfg: Config): string {
  return cfg.jupiterApiKey ? QUOTE_URL_PRO : QUOTE_URL_LITE;
}

// Tokens indexed by mint for quick lookup
const TOKEN_BY_MINT = Object.fromEntries(
  Object.values(TOKENS).map(t => [t.mint, t])
);
const TOKEN_BY_SYMBOL = Object.fromEntries(
  Object.values(TOKENS).map(t => [t.symbol, t])
);

interface RoundTripResult {
  inputAmount: bigint;
  outputAmount: bigint;
  profitAmount: bigint;
  grossProfitLamports: bigint;
  profitPct: number;
  profitUsd: number;
  netProfitPct: number;
  netProfitUsd: number;
  leg1Raw: unknown;
  leg2Raw: unknown;
  intermediateOutAmount: bigint;
  inputMint: string;
  outputMint: string;  // intermediate
  route: string;
}

/**
 * Fetch best Jupiter A→B quote.
 */
async function fetchQuote(
  inputMint: string,
  outputMint: string,
  amount: bigint,
  cfg: Config
): Promise<{ outAmount: bigint; raw: unknown; route: string } | null> {
  const headers = cfg.jupiterApiKey ? { 'x-api-key': cfg.jupiterApiKey } : {};
  try {
    const r = await axios.get(getQuoteUrl(cfg), {
      params: {
        inputMint,
        outputMint,
        amount: amount.toString(),
        slippageBps: cfg.maxSlippageBps,
        onlyDirectRoutes: false,
      },
      timeout: 5_000,
      headers,
    });
    if (!r.data?.outAmount) return null;
    let route = '';
    try {
      const plan = r.data.routePlan as Array<{ swapInfo: { label: string } }>;
      route = plan?.map(p => p.swapInfo?.label ?? '?').join('→') ?? '';
    } catch { /* ignore */ }
    return { outAmount: BigInt(r.data.outAmount), raw: r.data, route };
  } catch {
    return null;
  }
}

/**
 * Check if a pool update has a profitable round-trip arb.
 */
async function checkRoundTrip(
  pool: PoolAccount,
  cfg: Config,
  usdPrices: Record<string, number>
): Promise<RoundTripResult | null> {
  const tokenA = TOKEN_BY_SYMBOL[pool.tokenA];
  const tokenB = TOKEN_BY_SYMBOL[pool.tokenB];
  if (!tokenA || !tokenB) return null;

  const solUsd = usdPrices['SOL'] ?? 0;
  const aUsd   = usdPrices[tokenA.symbol] ?? 0;

  // Compute input amount in tokenA units (USD equivalent of tradeSizeSol)
  let inputAmount: bigint;
  if (tokenA.symbol === 'SOL') {
    inputAmount = BigInt(Math.floor(cfg.tradeSizeSol * 1e9));
  } else if (aUsd > 0 && solUsd > 0) {
    const tradeUsd = cfg.tradeSizeSol * solUsd;
    inputAmount = BigInt(Math.floor((tradeUsd / aUsd) * 10 ** tokenA.decimals));
  } else {
    inputAmount = BigInt(1000) * BigInt(10 ** tokenA.decimals);
  }

  // Both legs in parallel — A→B and then B→A with expected output
  // First get A→B, then use its output for B→A
  // We estimate B→A input as the expected A→B output from a prior scan, but since
  // we don't have it yet, fetch both directions simultaneously with estimated amounts
  const [leg1, leg1Rev] = await Promise.all([
    fetchQuote(tokenA.mint, tokenB.mint, inputAmount, cfg),
    // Also try B→A with a rough estimate (will be refined if leg1 succeeds)
    null as null,
  ]);

  if (!leg1) return null;

  // Now fetch leg2 using actual leg1 output
  const leg2 = await fetchQuote(tokenB.mint, tokenA.mint, leg1.outAmount, cfg);
  if (!leg2) return null;

  if (leg2.outAmount <= inputAmount) return null;

  const profitAmount = leg2.outAmount - inputAmount;
  const profitPct = Number(profitAmount) / Number(inputAmount) * 100;
  const profitHuman = Number(profitAmount) / 10 ** tokenA.decimals;
  const profitUsd = profitHuman * aUsd;

  // Calculate net profit after fees
  const net = calcNetProfit(
    tokenA.symbol,
    tokenA.decimals,
    inputAmount,
    leg2.outAmount,
    cfg.dryRun ? 0n : cfg.jitoTipLamports,
    usdPrices
  );

  return {
    inputAmount,
    outputAmount: leg2.outAmount,
    profitAmount,
    grossProfitLamports: net.grossProfitLamports,
    profitPct,
    profitUsd,
    netProfitPct: net.netProfitPct,
    netProfitUsd: net.netProfitUsd,
    leg1Raw: leg1.raw,
    leg2Raw: leg2.raw,
    intermediateOutAmount: leg1.outAmount,
    inputMint: tokenA.mint,
    outputMint: tokenB.mint,
    route: `${leg1.route} | ${leg2.route}`,
  };
}

export class EventHandler {
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private lastExecutionAt = 0;
  private executing = false;  // atomic lock — prevents concurrent executions
  private executionCount = 0;
  private skipCount = 0;
  private usdPrices: Record<string, number> = {};
  private pricesFetchedAt = 0;

  constructor(
    private wallet: Keypair,
    private connection: Connection,
    private cfg: Config,
    private onTrade: () => void
  ) {}

  /**
   * Called on every pool account change.
   * Debounces per-pool so rapid sequential updates don't trigger multiple quotes.
   */
  onPoolUpdate(pool: PoolAccount): void {
    const key = pool.address;
    const existing = this.debounceTimers.get(key);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.debounceTimers.delete(key);
      this.handleUpdate(pool).catch(err => {
        logger.debug('Event handler error', err);
      });
    }, 50);  // 50ms debounce

    this.debounceTimers.set(key, timer);
  }

  private async handleUpdate(pool: PoolAccount): Promise<void> {
    // Atomic execution lock — one trade at a time, no concurrent fires
    if (this.executing) {
      this.skipCount++;
      return;
    }
    const now = Date.now();
    const msSinceLast = now - this.lastExecutionAt;
    if (msSinceLast < 5_000) {
      this.skipCount++;
      return;
    }

    // Refresh USD prices at most every 30s
    if (now - this.pricesFetchedAt > 30_000) {
      try {
        this.usdPrices = await getUsdPrices(Object.keys(TOKENS));
        this.pricesFetchedAt = now;
      } catch { /* use stale prices */ }
    }

    const result = await checkRoundTrip(pool, this.cfg, this.usdPrices);
    if (!result) return;

    // SANITY GUARD: >5% is phantom data — check BEFORE near-miss logging
    if (result.profitPct > 5.0) {
      logger.warn(`🚨 REJECTED phantom signal: ${result.profitPct.toFixed(1)}% on ${pool.tokenA}/${pool.tokenB} — route: ${result.route}`);
      return;
    }

    // ROUTE GUARD: reject exotic DEXes before anything else
    if (routeHasExoticDex(result.route)) {
      logger.debug(`Filtered exotic DEX route: ${result.route}`);
      return;
    }

    // SAME-DEX GUARD: if both legs route through the same DEX, leg 1 moves the price
    // and leg 2 loses the spread — net result is fees with no profit
    const [leg1Route, leg2Route] = result.route.split(' | ');
    if (leg1Route && leg2Route && leg1Route.trim() === leg2Route.trim()) {
      logger.debug(`Rejected same-DEX round-trip: ${result.route}`);
      return;
    }

    // Gate on NET profit (after fees) — gross checks miss the fee floor
    if (result.netProfitPct < this.cfg.minProfitPct || result.netProfitUsd < this.cfg.minProfitUsd) {
      // Log near-misses that passed DEX filter and are >50% of net threshold
      if (result.grossProfitLamports > 0n && result.profitPct > this.cfg.minProfitPct * 0.5) {
        logger.info(
          `📊 Near-miss (gross ${result.profitPct.toFixed(3)}% / $${result.profitUsd.toFixed(4)}, ` +
          `net ${result.netProfitPct.toFixed(3)}% / $${result.netProfitUsd.toFixed(4)} after fees) ` +
          `${pool.tokenA}/${pool.tokenB} | ${result.route}`
        );
      }
      return;
    }

    logger.info(
      `⚡ Event-driven opp: ${pool.tokenA}→${pool.tokenB}→${pool.tokenA} | ` +
      `gross ${result.profitPct.toFixed(3)}% / $${result.profitUsd.toFixed(4)} | ` +
      `net ${result.netProfitPct.toFixed(3)}% / $${result.netProfitUsd.toFixed(4)} | ` +
      `Route: ${result.route}`
    );

    if (this.cfg.dryRun) {
      logger.info(`🧪 DRY RUN — would execute`);
      return;
    }

    this.lastExecutionAt = Date.now();
    this.executing = true;

    // Build CircularOpportunity shape for executor
    const tokenA = Object.values(TOKENS).find(t => t.mint === result.inputMint)!;
    const opp: CircularOpportunity = {
      token: tokenA,
      inputAmount: result.inputAmount,
      outputAmount: result.outputAmount,
      profitAmount: result.profitAmount,
      profitPct: result.profitPct,
      profitUsd: result.profitUsd,
      netProfitPct: result.netProfitPct,
      netProfitUsd: result.netProfitUsd,
      rawQuote: result.leg1Raw,
      route: result.route,
      buyDex: pool.dex,
      sellDex: 'Jupiter',
      buyQuoteRaw: result.leg1Raw,
      sellInputAmount: result.intermediateOutAmount,
    };

    try {
      const execResult = await executeCircular(opp, this.wallet, this.connection, this.cfg);
      if (execResult.success) {
        this.executionCount++;
        this.onTrade();
        logger.info(`✅ Event-driven arb complete! Total executions: ${this.executionCount}`);
      } else {
        logger.warn(`❌ Event-driven execution failed: ${execResult.error}`);
        // Auto-recover stranded intermediate token (e.g. USDC after failed leg 2)
        // Trigger whenever leg 1 confirmed — we may be holding intermediate token
        const intermediateMint = (opp.buyQuoteRaw as { outputMint?: string })?.outputMint;
        if (intermediateMint && execResult.leg1Sig) {
          logger.info('Leg 1 landed, leg 2 failed — auto-recovering intermediate token...');
          await new Promise(r => setTimeout(r, 2_000)); // wait for chain to settle
          await recoverStrandedTokens(intermediateMint, this.wallet, this.connection, this.cfg);
        }
      }
    } finally {
      // Always release lock — even on failure/exception
      this.executing = false;
    }
  }

  getStats(): { executions: number; skipped: number } {
    return { executions: this.executionCount, skipped: this.skipCount };
  }
}
