/**
 * Solana Arbitrage Bot — Entry Point
 *
 * Main loop:
 * 1. Load config & validate env
 * 2. Init wallet
 * 3. Every SCAN_INTERVAL_MS:
 *    a. Fetch quotes from all DEXes in parallel
 *    b. Detect arbitrage opportunities
 *    c. Execute best opportunity via Jito (if not DRY_RUN)
 *    d. Log scan metrics
 */

import { Connection, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

import { loadConfig, validateConfig, Config } from './config';
import { logger } from './utils/logger';
import { getUsdPrices } from './utils/prices';
import { TOKENS, Token, PairQuotes, DexQuote, ScanMetrics, ExecutionResult, ArbitrageOpportunity } from './types';
import { fetchJupiterQuote } from './monitor/jupiter';
import { fetchRaydiumQuote } from './monitor/raydium';
import { fetchOrcaQuote } from './monitor/orca';
import { fetchMeteoraQuote } from './monitor/meteora';
import { scanOpportunities } from './scanner/opportunities';
import { buildBundle, hasEnoughBalance } from './executor/builder';
import { submitJitoBundle } from './executor/jito';

// ─── Token pairs to monitor ────────────────────────────────────────────────────

interface TokenPair {
  input: Token;
  output: Token;
}

const PAIRS: TokenPair[] = [
  { input: TOKENS.JUP,   output: TOKENS.SOL  },
  { input: TOKENS.PENGU, output: TOKENS.SOL  },
  { input: TOKENS.BONK,  output: TOKENS.SOL  },
  { input: TOKENS.JUP,   output: TOKENS.BONK },
];

// ─── Rate limiter ─────────────────────────────────────────────────────────────

class RateLimiter {
  private timestamps: number[] = [];
  constructor(private maxPerMinute: number) {}

  canExecute(): boolean {
    const now = Date.now();
    const windowStart = now - 60_000;
    this.timestamps = this.timestamps.filter((t) => t > windowStart);
    return this.timestamps.length < this.maxPerMinute;
  }

  record(): void {
    this.timestamps.push(Date.now());
  }
}

// ─── Quote fetcher ────────────────────────────────────────────────────────────

async function fetchAllQuotesForPair(
  pair: TokenPair,
  inputAmountLamports: bigint,
  slippageBps: number
): Promise<{ quotes: DexQuote[]; errors: string[] }> {
  const { input, output } = pair;
  const errors: string[] = [];

  const results = await Promise.allSettled([
    fetchJupiterQuote(input, output, inputAmountLamports, slippageBps),
    fetchRaydiumQuote(input, output, inputAmountLamports, slippageBps),
    fetchOrcaQuote(input, output, inputAmountLamports, slippageBps),
    fetchMeteoraQuote(input, output, inputAmountLamports, slippageBps),
  ]);

  const quotes: DexQuote[] = [];
  const dexNames = ['Jupiter', 'Raydium', 'Orca', 'Meteora'] as const;

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled' && r.value !== null) {
      quotes.push(r.value);
    } else if (r.status === 'rejected') {
      errors.push(`${dexNames[i]}: ${r.reason?.message ?? 'unknown error'}`);
    }
  }

  return { quotes, errors };
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
  const allErrors: string[] = [];
  let quotesTotal = 0;
  let quotesFailed = 0;
  let opportunitiesFound = 0;
  let tradesExecuted = 0;

  // ── USD prices ──────────────────────────────────────────────────────────────
  const symbols = Object.keys(TOKENS);
  const usdPrices = await getUsdPrices(symbols);
  logger.debug('USD prices', usdPrices);

  // ── Trade size in input-token lamports ─────────────────────────────────────
  const tradeSizeLamports = BigInt(
    Math.floor(cfg.tradeSizeSol * Math.pow(10, TOKENS.SOL.decimals))
  );

  // ── Fetch all quotes in parallel ────────────────────────────────────────────
  const pairQuotesList: PairQuotes[] = [];
  const quoteResults = await Promise.allSettled(
    PAIRS.map(async (pair) => {
      // Scale trade size to input token if it's not SOL
      let inputAmt: bigint;
      if (pair.input.symbol === 'SOL') {
        inputAmt = tradeSizeLamports;
      } else {
        const solUsd = usdPrices['SOL'] ?? 0;
        const tokenUsd = usdPrices[pair.input.symbol] ?? 0;
        if (tokenUsd === 0 || solUsd === 0) {
          // Fallback: use 1000 units of the input token
          inputAmt = BigInt(1000) * BigInt(Math.pow(10, pair.input.decimals));
        } else {
          const humanAmt = (cfg.tradeSizeSol * solUsd) / tokenUsd;
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

  // ── Scan for opportunities ─────────────────────────────────────────────────
  const opps = scanOpportunities(pairQuotesList, usdPrices, {
    minProfitPct: cfg.minProfitPct,
    minProfitUsd: cfg.minProfitUsd,
  });
  opportunitiesFound = opps.length;

  if (opps.length > 0) {
    logger.info(`🔍 Scan #${scanNumber}: Found ${opps.length} opportunity(ies)`);
    for (const opp of opps) {
      logger.info(
        `  ↳ ${opp.inputSymbol}→${opp.outputSymbol}: buy@${opp.buyDex} sell@${opp.sellDex}` +
        ` | ${opp.profitPct.toFixed(3)}% / $${opp.profitUsd.toFixed(4)}`
      );
    }
  } else {
    logger.debug(`Scan #${scanNumber}: No opportunities`);
  }

  // ── Execute best opportunity ───────────────────────────────────────────────
  if (opps.length > 0 && !cfg.dryRun) {
    const best = opps[0];
    await executeOpportunity(best, wallet, connection, cfg, rateLimiter);
    tradesExecuted++;
  } else if (opps.length > 0 && cfg.dryRun) {
    logger.info(`🧪 DRY RUN — would execute: ${opps[0].inputSymbol}→${opps[0].outputSymbol}`);
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

// ─── Execution ────────────────────────────────────────────────────────────────

async function executeOpportunity(
  opp: ArbitrageOpportunity,
  wallet: Keypair,
  connection: Connection,
  cfg: Config,
  rateLimiter: RateLimiter
): Promise<ExecutionResult> {
  if (!rateLimiter.canExecute()) {
    logger.warn('Rate limit reached, skipping execution');
    return {
      opportunity: opp,
      success: false,
      dryRun: false,
      error: 'Rate limit exceeded',
      executedAt: Date.now(),
      tipLamports: cfg.jitoTipLamports,
    };
  }

  // Check balance
  const tradeSizeLamports = BigInt(
    Math.floor(cfg.tradeSizeSol * Math.pow(10, TOKENS.SOL.decimals))
  );
  const sufficientBalance = await hasEnoughBalance(wallet, connection, tradeSizeLamports);
  if (!sufficientBalance) {
    return {
      opportunity: opp,
      success: false,
      dryRun: false,
      error: 'Insufficient balance',
      executedAt: Date.now(),
      tipLamports: cfg.jitoTipLamports,
    };
  }

  // Build bundle
  const bundle = await buildBundle(opp, wallet, connection, cfg);
  if (!bundle) {
    return {
      opportunity: opp,
      success: false,
      dryRun: false,
      error: 'Bundle build failed',
      executedAt: Date.now(),
      tipLamports: cfg.jitoTipLamports,
    };
  }

  // Submit to Jito
  const jitoResult = await submitJitoBundle(bundle.transactions, cfg.jitoUuid);
  rateLimiter.record();

  const result: ExecutionResult = {
    opportunity: opp,
    bundleId: jitoResult.bundleId,
    success: jitoResult.success,
    dryRun: false,
    error: jitoResult.error,
    executedAt: Date.now(),
    tipLamports: bundle.tipLamports,
  };

  if (jitoResult.success) {
    logger.info(
      `✅ Trade executed! Bundle: ${jitoResult.bundleId}` +
      ` | Tip: ${bundle.tipLamports} lamports` +
      ` | Expected profit: $${opp.profitUsd.toFixed(4)}`
    );
  } else {
    logger.error(`❌ Trade failed: ${jitoResult.error}`);
  }

  return result;
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Load and validate config
  let cfg: Config;
  try {
    cfg = loadConfig();
    validateConfig(cfg);
  } catch (err) {
    logger.error('Config validation failed', err);
    process.exit(1);
  }

  logger.info('🚀 Solana Arbitrage Bot starting...');
  logger.info(`  Mode: ${cfg.dryRun ? '🧪 DRY RUN' : '🔥 LIVE'}`);
  logger.info(`  RPC: ${cfg.rpcUrl}`);
  logger.info(`  Trade size: ${cfg.tradeSizeSol} SOL`);
  logger.info(`  Min profit: ${cfg.minProfitPct}% or $${cfg.minProfitUsd}`);
  logger.info(`  Scan interval: ${cfg.scanIntervalMs}ms`);
  logger.info(`  Max trades/min: ${cfg.maxTradesPerMinute}`);

  // Init wallet
  let wallet: Keypair;
  const isPlaceholderKey =
    !cfg.walletPrivateKey ||
    cfg.walletPrivateKey === 'your_base58_private_key_here';

  if (isPlaceholderKey && cfg.dryRun) {
    wallet = Keypair.generate();
    logger.warn(`  ⚠️  No wallet key set — using throwaway keypair for DRY RUN only`);
    logger.warn(`  Throwaway pubkey: ${wallet.publicKey.toBase58()}`);
    logger.warn(`  Set WALLET_PRIVATE_KEY before going live!`);
  } else {
    try {
      const secretKey = bs58.decode(cfg.walletPrivateKey);
      wallet = Keypair.fromSecretKey(secretKey);
      logger.info(`  Wallet: ${wallet.publicKey.toBase58()}`);
    } catch (err) {
      logger.error('Failed to load wallet from WALLET_PRIVATE_KEY', err);
      process.exit(1);
    }
  }

  // Init connection
  const connection = new Connection(cfg.rpcUrl, {
    commitment: 'confirmed',
    wsEndpoint: cfg.rpcWsUrl,
  });

  // Check balance on start
  try {
    const balance = await connection.getBalance(wallet.publicKey);
    logger.info(`  Balance: ${(balance / 1e9).toFixed(4)} SOL`);
    if (balance < 50_000_000) {
      logger.warn('⚠️  Balance below 0.05 SOL minimum reserve');
    }
  } catch (err) {
    logger.warn('Could not fetch initial balance (RPC may be slow)', err);
  }

  const rateLimiter = new RateLimiter(cfg.maxTradesPerMinute);
  let scanNumber = 0;
  let totalOpportunities = 0;
  let totalTrades = 0;

  logger.info('🔄 Starting scan loop...\n');

  // ── Main loop ───────────────────────────────────────────────────────────────
  const runLoop = async (): Promise<void> => {
    scanNumber++;
    try {
      const metrics = await runScan(cfg, wallet, connection, rateLimiter, scanNumber);
      totalOpportunities += metrics.opportunitiesFound;
      totalTrades += metrics.tradesExecuted;

      if (scanNumber % 60 === 0) {
        logger.info(
          `📊 Stats: scans=${scanNumber} opps=${totalOpportunities} trades=${totalTrades}` +
          ` | last scan: ${metrics.durationMs}ms`
        );
      }

      if (metrics.errors.length > 0) {
        logger.debug(`Scan #${scanNumber} errors:`, metrics.errors);
      }
    } catch (err) {
      logger.error(`Scan #${scanNumber} crashed`, err);
    }

    setTimeout(runLoop, cfg.scanIntervalMs);
  };

  runLoop();
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

process.on('SIGINT', () => {
  logger.info('\n👋 Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down...');
  process.exit(0);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', reason);
});

main().catch((err) => {
  logger.error('Fatal error in main()', err);
  process.exit(1);
});
