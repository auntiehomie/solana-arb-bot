/**
 * Cross-DEX arbitrage scanner using Jupiter DEX-filtered quotes.
 *
 * Compares executable prices across DEXes by asking Jupiter:
 *   "route this trade but ONLY through DEX X"
 * This gives real executable prices — not spot prices from pool APIs.
 *
 * If DEX A gives better output than DEX B for the same input,
 * buy on DEX A and sell on DEX B for a profit.
 *
 * Both legs execute via Jupiter swap API (one tx each) but with
 * fresh quotes fetched at execution time — prices are real.
 */

import axios from 'axios';
import { Token } from '../types';
import { Config } from '../config';
import { logger } from '../utils/logger';
import { routeHasExoticDex } from '../utils/dex-blocklist';
import { calcNetProfit } from '../utils/fees';

export interface CircularOpportunity {
  token: Token;
  inputAmount: bigint;
  outputAmount: bigint;
  profitAmount: bigint;
  profitPct: number;
  profitUsd: number;
  /** Net profit after deducting estimated Solana tx fees */
  netProfitPct: number;
  netProfitUsd: number;
  rawQuote: unknown;       // Jupiter quote for the single best-path swap
  route: string;
  // For cross-DEX: buy leg details
  buyDex: string;
  sellDex: string;
  buyQuoteRaw: unknown;
  sellInputAmount: bigint; // how much intermediate token we get from buy
}

// DEXes to compare — must be valid Jupiter `dexes=` filter values
const DEX_LABELS: Record<string, string[]> = {
  'Jupiter AMM': ['Obric V2', 'Meteora DLMM', 'Raydium CLMM', 'Whirlpool'],
};

// Simpler: just compare top-2 routes Jupiter returns for the same pair
// Jupiter's /quote returns the best route — DEX filter lets us force specific venues

function getQuoteUrl(cfg: Config): string {
  return cfg.jupiterApiKey
    ? 'https://api.jup.ag/swap/v1/quote'
    : 'https://lite-api.jup.ag/swap/v1/quote';
}

interface DexQuoteResult {
  dex: string;
  outAmount: bigint;
  raw: unknown;
}

/**
 * Fetch a Jupiter quote restricted to a specific DEX label.
 * Returns null if no route found or on error.
 */
async function fetchDexQuote(
  inputMint: string,
  outputMint: string,
  amountLamports: bigint,
  dexLabel: string,
  cfg: Config
): Promise<DexQuoteResult | null> {
  const jupHeaders = cfg.jupiterApiKey ? { 'x-api-key': cfg.jupiterApiKey } : {};
  try {
    const resp = await axios.get(getQuoteUrl(cfg), {
      params: {
        inputMint,
        outputMint,
        amount: amountLamports.toString(),
        slippageBps: cfg.maxSlippageBps,
        onlyDirectRoutes: true,
        dexes: dexLabel,
      },
      timeout: 6_000,
      headers: jupHeaders,
    });
    const data = resp.data;
    if (!data?.outAmount) return null;
    return { dex: dexLabel, outAmount: BigInt(data.outAmount), raw: data };
  } catch {
    return null;
  }
}

/**
 * Fetch best unrestricted Jupiter quote (all DEXes, best route).
 */
async function fetchBestQuote(
  inputMint: string,
  outputMint: string,
  amountLamports: bigint,
  cfg: Config
): Promise<{ outAmount: bigint; raw: unknown; route: string } | null> {
  const jupHeaders = cfg.jupiterApiKey ? { 'x-api-key': cfg.jupiterApiKey } : {};
  try {
    const resp = await axios.get(getQuoteUrl(cfg), {
      params: {
        inputMint,
        outputMint,
        amount: amountLamports.toString(),
        slippageBps: cfg.maxSlippageBps,
        onlyDirectRoutes: false,
      },
      timeout: 8_000,
      headers: jupHeaders,
    });
    const data = resp.data;
    if (!data?.outAmount) return null;
    let route = 'best';
    try {
      const plan = data.routePlan as Array<{ swapInfo: { label: string } }>;
      if (plan?.length) route = plan.map(p => p.swapInfo?.label ?? '?').join('→');
    } catch { /* ignore */ }
    return { outAmount: BigInt(data.outAmount), raw: data, route };
  } catch {
    return null;
  }
}

/**
 * Scan one token pair for cross-DEX arbitrage.
 *
 * Strategy: get the best unrestricted quote for A→B, then get the best
 * unrestricted quote for B→A using the output amount. If outAmount(B→A) > inAmount(A→B),
 * we have a profitable round-trip — execute both as separate Jupiter swaps.
 */
async function scanPair(
  tokenA: Token,
  tokenB: Token,
  inputAmount: bigint,
  cfg: Config,
  tokenPricesUsd: Record<string, number>
): Promise<CircularOpportunity | null> {
  // Leg 1: A → B (buy B)
  const leg1 = await fetchBestQuote(tokenA.mint, tokenB.mint, inputAmount, cfg);
  if (!leg1) return null;

  // Leg 2: B → A (sell B back to A), using the output from leg 1
  const leg2 = await fetchBestQuote(tokenB.mint, tokenA.mint, leg1.outAmount, cfg);
  if (!leg2) return null;

  // Check profitability: did we get more A back than we started with?
  if (leg2.outAmount <= inputAmount) return null;

  const profitAmount = leg2.outAmount - inputAmount;
  const profitPct = Number(profitAmount) / Number(inputAmount) * 100;
  const profitHuman = Number(profitAmount) / Math.pow(10, tokenA.decimals);
  const priceUsd = tokenPricesUsd[tokenA.symbol] ?? 0;
  const profitUsd = profitHuman * priceUsd;

  // Sanity cap — real liquid-pair arb is <5%; anything above is a bad quote
  if (profitPct > 5.0) return null;

  // Reject exotic DEXes with known bad price feeds
  const route = `${leg1.route} | ${leg2.route}`;
  if (routeHasExoticDex(route)) return null;

  // Calculate net profit after estimated tx fees
  // dry-run: no Jito tip; live: use config tip
  const net = calcNetProfit(
    tokenA.symbol,
    tokenA.decimals,
    inputAmount,
    leg2.outAmount,
    cfg.dryRun ? 0n : cfg.jitoTipLamports,
    tokenPricesUsd
  );

  // Gate on net profit (after fees) against configured thresholds
  if (net.netProfitPct < cfg.minProfitPct) return null;
  if (net.netProfitUsd < cfg.minProfitUsd) return null;

  return {
    token: tokenA,
    inputAmount,
    outputAmount: leg2.outAmount,
    profitAmount,
    profitPct,
    profitUsd,
    netProfitPct: net.netProfitPct,
    netProfitUsd: net.netProfitUsd,
    rawQuote: leg1.raw,      // leg 1 quote (buy)
    route,
    buyDex: leg1.route,
    sellDex: leg2.route,
    buyQuoteRaw: leg1.raw,
    sellInputAmount: leg1.outAmount,
  };
}

/**
 * Scan all token pairs for round-trip arbitrage opportunities.
 */
export async function scanCircular(
  tokens: Token[],
  tradeSizeLamports: bigint,
  cfg: Config,
  tokenPricesUsd: Record<string, number>
): Promise<CircularOpportunity[]> {
  // Build all A→B pairs (not B→A since we already check round-trip internally)
  const pairs: [Token, Token][] = [];
  for (let i = 0; i < tokens.length; i++) {
    for (let j = 0; j < tokens.length; j++) {
      if (i !== j) pairs.push([tokens[i], tokens[j]]);
    }
  }

  const results = await Promise.all(
    pairs.map(([a, b]) => {
      // Size the trade in token A's units
      const solUsd = tokenPricesUsd['SOL'] ?? 0;
      const aUsd = tokenPricesUsd[a.symbol] ?? 0;
      let amt: bigint;
      if (a.symbol === 'SOL') {
        amt = tradeSizeLamports;
      } else if (aUsd > 0 && solUsd > 0) {
        const tradeUsd = cfg.tradeSizeSol * solUsd;
        amt = BigInt(Math.floor((tradeUsd / aUsd) * 10 ** a.decimals));
      } else {
        amt = BigInt(1000) * BigInt(10 ** a.decimals);
      }
      return scanPair(a, b, amt, cfg, tokenPricesUsd);
    })
  );

  return results
    .filter((r): r is CircularOpportunity => r !== null)
    .sort((a, b) => b.profitPct - a.profitPct);
}
