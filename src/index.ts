// Entry point for the Solana arbitrage bot
import dotenv from 'dotenv';
import path from 'path';
import { Connection, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

import { loadConfig, validateConfig, Config } from './config';
import { logger } from './utils/logger';
import { getUsdPrices, setJupiterPriceApiKey } from './utils/prices';
import { TOKENS, Token, PairQuotes, DexQuote, ScanMetrics, ExecutionResult, ArbitrageOpportunity } from './types';
import { fetchJupiterQuote } from './monitor/jupiter';
import { fetchRaydiumQuote } from './monitor/raydium';
import { fetchOrcaQuote } from './monitor/orca';
import { fetchMeteoraQuote } from './monitor/meteora';
import { scanOpportunities } from './scanner/opportunities';
import { buildBundle, hasEnoughBalance } from './executor/builder';
import { submitJitoBundle } from './executor/jito';
import { scanTriangularOpportunities } from './scanner/triangular';

// ─── Simulated P&L tracking (dry run) ─────────────────────────────────────────
let simulatedPnlUsd = 0;

// ─── Token pairs to monitor ───────────────────────────────────────────────────

interface TokenPair {
  input: Token;
  output: Token;
}

const PAIRS: TokenPair[] = [
  { input: TOKENS.SOL, output: TOKENS.JUP },
  { input: TOKENS.SOL, output: TOKENS.PENGU },
  { input: TOKENS.SOL, output: TOKENS.BONK },
  { input: TOKENS.JUP, output: TOKENS.SOL },
  { input: TOKENS.PENGU, output: TOKENS.SOL },
  { input: TOKENS.BONK, output: TOKENS.SOL },
  { input: TOKENS.JUP, output: TOKENS.BONK },
  { input: TOKENS.BONK, output: TOKENS.JUP },
];

// ─── Rate limiter ─────────────────────────────────────────────────────────────

class RateLimiter {
  private timestamps: number[] = [];
  constructor(private maxPerMinute: number) {}

  canProceed(): boolean {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < 60_000);
    return this.timestamps.length < this.maxPerMinute;
  }

  record(): void {
    this.timestamps.push(Date.now());
  }
}

// ─── Fetch all quotes for a pair ──────────────────────────────────────────────

async function fetchAllQuotesForPair(
  pair: TokenPair,
  inputAmountLamports: bigint,
  slippageBps: number
): Promise<{ quotes: DexQuote[]; errors: string[] }> {
  const quotes: DexQuote[] = [];
  const errors: string[] = [];

  const fetchers = [
    { name: 'Jupiter', fn: () => fetchJupiterQuote(pair.input, pair.output, inputAmountLamports, slippageBps) },
    { name: 'Raydium', fn: () => fetchRaydiumQuote(pair.input, pair.output, inputAmountLamports, slippageBps) },
    { name: 'Orca', fn: () => fetchOrcaQuote(pair.input, pair.output, inputAmountLamports, slippageBps) },
    { name: 'Meteora', fn: () => fetchMeteoraQuote(pair.input, pair.output, inputAmountLamports, slippageBps) },
  ];

  const results = await Promise.allSettled(fetchers.map((f) => f.fn()));

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled' && result.value) {
      quotes.push(result.value);
    } else if (result.status === 'rejected') {
      errors.push(`${fetchers[i].name} quote failed: ${result.reason?.message ?? 'unknown'}`);
    }
  }

  return { quotes, errors };
}

// ─── Execute an opportunity ───────────────────────────────────────────────────

async function executeOpportunity(
  opp: ArbitrageOpportunity,
  wallet: Keypair,
  connection: Connection,
  cfg: Config,
  rateLimiter: RateLimiter
): Promise<void> {
  if (!rateLimiter.canProceed()) {
    logger.warn('Rate limit reached — skipping execution');
    return;
  }

  // Balance check
  const hasBalance = await hasEnoughBalance(wallet, connection, opp.inputAmount);
  if (!hasBalance) {
    logger.warn('Insufficient balance — skipping execution');
    return;
  }

  logger.info(
    `🚀 Executing: ${opp.inputSymbol}→${opp.outputSymbol} | ` +
    `Buy on ${opp.buyDex}, sell on ${opp.sellDex} | ` +
    `Expected profit: ${opp.profitPct.toFixed(3)}% / $${opp.profitUsd.toFixed(4)}`
  );

  const bundle = await buildBundle(opp, wallet, connection, cfg);
  if (!bundle) {
    logger.error('Bundle build failed — aborting execution');
    return;
  }

  const result = await submitJitoBundle(bundle.transactions, cfg.jitoUuid);
  if (result.success) {
    logger.info(`✅ Bundle accepted: ${result.bundleId}`);
    rateLimiter.record();
  } else {
    logger.error(`❌ Bundle rejected: ${result.error}`);
  }
}

// ─── Main scan loop ───────────────────────────────────────────────────────────

async function runScan(
  cfg: Config,
  wallet: Keypair,
  connection: Connection,
  rateLimiter: RateLimiter,
  scanNumber: number
): Promise<ScanMetrics> {
  const startedAt = Date.now();
  let quotesTotal = 0;
  let quotesFailed = 0;
  let opportunitiesFound = 0;
  let tradesExecuted = 0;
  const allErrors: string[] = [];

  // ── USD prices ──────────────────────────────────────────────────────────────
  const symbols = Object.keys(TOKENS);
  const usdPrices = await getUsdPrices(symbols);
  logger.debug('USD prices', usdPrices);

  // ── Trade sizes loop (multi-size scanning) ─────────────────────────────────
  const pairQuotesList: PairQuotes[] = [];
  for (const tradeSizeSol of cfg.tradeSizes) {
    const tradeSizeLamports = BigInt(Math.floor(tradeSizeSol * Math.pow(10, TOKENS.SOL.decimals)));
    // Fetch quotes per pair for this trade size
    const quoteResults = await Promise.allSettled(
      PAIRS.map(async (pair) => {
        let inputAmt: bigint;
        if (pair.input.symbol === 'SOL') {
          inputAmt = tradeSizeLamports;
        } else {
          const solUsd = usdPrices['SOL'] ?? 0;
          const tokenUsd = usdPrices[pair.input.symbol] ?? 0;
          if (tokenUsd === 0 || solUsd === 0) {
            inputAmt = BigInt(1000) * BigInt(Math.pow(10, pair.input.decimals));
          } else {
            const humanAmt = (tradeSizeSol * solUsd) / tokenUsd;
            inputAmt = BigInt(Math.floor(humanAmt * Math.pow(10, pair.input.decimals)));
          }
        }

        const { quotes, errors } = await fetchAllQuotesForPair(
          pair,
          inputAmt,
          cfg.maxSlippageBps
        );
        allErrors.push(...errors);
        return { pair, quotes, inputAmt };
      })
    );

    for (const result of quoteResults) {
      if (result.status === 'rejected') {
        allErrors.push(`Pair quote batch failed: ${result.reason?.message}`);
        quotesFailed++;
        continue;
      }

      const { pair, quotes, inputAmt } = result.value;
      quotesTotal += 4; // 4 DEXes per pair
      quotesFailed += 4 - quotes.length;

      if (quotes.length < 2) continue;

      pairQuotesList.push({
        inputSymbol: pair.input.symbol,
        outputSymbol: pair.output.symbol,
        quotes,
      });
    }
  }

  // ── Scan for direct opportunities ──────────────────────────────────────────
  const opps = scanOpportunities(pairQuotesList, usdPrices, {
    minProfitPct: cfg.minProfitPct,
    minProfitUsd: cfg.minProfitUsd,
  });

  // ── Wire triangular scanner inputs ─────────────────────────────────────────
  const allQuotesMap = new Map<string, DexQuote[]>();
  for (const pq of pairQuotesList) {
    const key = `${pq.inputSymbol}:${pq.outputSymbol}`;
    allQuotesMap.set(key, pq.quotes);
  }
  const triOpps = scanTriangularOpportunities(allQuotesMap, usdPrices, {
    minProfitPct: cfg.minProfitPct,
    minProfitUsd: cfg.minProfitUsd,
  });

  // ── Merge results ──────────────────────────────────────────────────────────
  const allOpps = [...opps, ...triOpps].sort((a, b) => {
    if (b.profitUsd !== a.profitUsd) return b.profitUsd - a.profitUsd;
    return b.profitPct - a.profitPct;
  });

  opportunitiesFound = allOpps.length;

  if (allOpps.length > 0) {
    logger.info(`Found ${allOpps.length} opportunities (${opps.length} direct, ${triOpps.length} triangular)`);
  }

  // ── Execute best opportunity ───────────────────────────────────────────────
  if (allOpps.length > 0 && !cfg.dryRun) {
    const best = allOpps[0];
    await executeOpportunity(best, wallet, connection, cfg, rateLimiter);
    tradesExecuted++;
  } else if (allOpps.length > 0 && cfg.dryRun) {
    // Accumulate simulated P&L from all opportunities found
    for (const opp of allOpps) {
      simulatedPnlUsd += opp.profitUsd;
    }
    logger.info(`🧪 DRY RUN — would execute: ${allOpps[0].inputSymbol}→${allOpps[0].outputSymbol}`);
    logger.info(`🧪 Simulated cumulative P&L: $${simulatedPnlUsd.toFixed(4)}`);
  }

  const completedAt = Date.now();
  return {
    scanNumber,
    startedAt,
    completedAt,
    durationMs: completedAt - startedAt,
    quotesTotal,
    quotesFailed,
    opportunitiesFound,
    tradesExecuted,
    errors: allErrors,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  logger.info('🤖 Solana Arbitrage Bot starting...');

  const cfg = loadConfig();
  validateConfig(cfg);

  logger.info(`Mode: ${cfg.dryRun ? '🧪 DRY RUN' : '🔴 LIVE TRADING'}`);
  logger.info(`RPC: ${cfg.rpcUrl}`);
  logger.info(`Trade sizes: ${cfg.tradeSizes.join(', ')} SOL`);
  logger.info(`Min profit: ${cfg.minProfitPct}% or $${cfg.minProfitUsd}`);
  logger.info(`Scan interval: ${cfg.scanIntervalMs}ms`);

  // Set Jupiter API key if provided
  if (cfg.jupiterApiKey) {
    setJupiterPriceApiKey(cfg.jupiterApiKey);
  }

  // Init wallet
  const wallet = Keypair.fromSecretKey(bs58.decode(cfg.walletPrivateKey));
  logger.info(`Wallet: ${wallet.publicKey.toBase58()}`);

  // Init connection
  const connection = new Connection(cfg.rpcUrl, {
    commitment: 'confirmed',
    wsEndpoint: cfg.rpcWsUrl,
  });

  // Check balance
  try {
    const balance = await connection.getBalance(wallet.publicKey);
    const solBalance = balance / 1e9;
    logger.info(`Balance: ${solBalance.toFixed(4)} SOL`);
    if (solBalance < 0.05) {
      logger.warn('⚠️ Low balance — may not have enough for fees');
    }
  } catch (err) {
    logger.error('Failed to check balance — RPC may be unreachable', err);
  }

  const rateLimiter = new RateLimiter(cfg.maxTradesPerMinute);
  let scanNumber = 0;

  logger.info('─── Starting scan loop ───');

  while (true) {
    scanNumber++;
    try {
      const metrics = await runScan(cfg, wallet, connection, rateLimiter, scanNumber);

      if (metrics.errors.length > 0) {
        logger.debug(`Scan #${scanNumber} errors:`, metrics.errors);
      }

      logger.info(
        `Scan #${scanNumber} done in ${metrics.durationMs}ms — ` +
        `quotes: ${metrics.quotesTotal - metrics.quotesFailed}/${metrics.quotesTotal}, ` +
        `opps: ${metrics.opportunitiesFound}, ` +
        `trades: ${metrics.tradesExecuted}`
      );
    } catch (err) {
      logger.error(`Scan #${scanNumber} crashed`, err);
    }

    await new Promise((r) => setTimeout(r, cfg.scanIntervalMs));
  }
}

main().catch((err) => {
  logger.error('Fatal error', err);
  process.exit(1);
});
