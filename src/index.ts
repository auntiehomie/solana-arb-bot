/**
 * Solana Arbitrage Bot — WebSocket-driven entry point.
 *
 * Primary path: Helius WS fires on pool swap → ~20ms latency → quote → execute
 * Fallback path: 60s polling heartbeat for any pools we missed
 *
 * Execution strategy: Jupiter round-trip A→B→A, both legs fired simultaneously.
 */

import { Connection, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

import { loadConfig, validateConfig } from './config';
import { logger } from './utils/logger';
import { getUsdPrices, setJupiterPriceApiKey } from './utils/prices';
import { TOKENS, ScanMetrics } from './types';
import { feeFloorPct } from './utils/fees';
import { hasEnoughBalance } from './executor/builder';
import { executeCircular } from './executor/direct';
import { scanCircular, CircularOpportunity } from './scanner/circular';
import { PoolWatcher } from './ws/pool-watcher';
import { EventHandler } from './ws/event-handler';
import { DiscordNotifier } from './discord';

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  logger.info('🤖 Solana Arbitrage Bot starting (WebSocket mode)...');

  const cfg = loadConfig();
  validateConfig(cfg);

  logger.info(`Mode: ${cfg.dryRun ? '🧪 DRY RUN' : '🔴 LIVE TRADING'}`);
  logger.info(`RPC: ${cfg.rpcUrl}`);
  logger.info(`Trade size: ${cfg.tradeSizeSol} SOL`);
  logger.info(`Min profit (net, after fees): ${cfg.minProfitPct}% / $${cfg.minProfitUsd}`);

  if (cfg.jupiterApiKey) {
    setJupiterPriceApiKey(cfg.jupiterApiKey);
  }

  // Log fee floor immediately after prices are available (best-effort)
  try {
    const startPrices = await getUsdPrices(['SOL']);
    const floor = feeFloorPct(cfg.tradeSizeSol, cfg.dryRun ? 0n : cfg.jitoTipLamports, startPrices);
    logger.info(
      `💸 Fee floor: ~${floor.toFixed(3)}% of trade size ` +
      `(SOL $${(startPrices['SOL'] ?? 0).toFixed(2)}, ` +
      `${cfg.dryRun ? 'no Jito tip (dry-run)' : `Jito tip ${cfg.jitoTipLamports} lam`})`
    );
  } catch {
    logger.debug('Could not fetch prices for fee floor display');
  }

  const wallet = Keypair.fromSecretKey(bs58.decode(cfg.walletPrivateKey));
  logger.info(`Wallet: ${wallet.publicKey.toBase58()}`);

  // Discord notifier for alerts
  const discord = new DiscordNotifier();
  if (discord.enabled) {
    await discord.sendStartup();
  }

  const connection = new Connection(cfg.rpcUrl, {
    commitment: 'confirmed',
    wsEndpoint: cfg.rpcWsUrl,
  });

  // RPC health tracking
  let consecutiveRpcFailures = 0;
  let consecutiveExecutionFailures = 0;
  const MAX_RPC_FAILURES = 3;
  const MAX_EXECUTION_FAILURES = 3;

  try {
    const balance = await connection.getBalance(wallet.publicKey);
    logger.info(`Balance: ${(balance / 1e9).toFixed(4)} SOL`);
    if (balance / 1e9 < 0.05) {
      logger.warn('⚠️  Low balance — may not cover fees');
      await discord.sendError({ message: `⚠️ Low balance: ${(balance / 1e9).toFixed(4)} SOL` });
    }
  } catch (err) {
    logger.error('Balance check failed — RPC may be unreachable', err);
    consecutiveRpcFailures++;
    if (consecutiveRpcFailures >= MAX_RPC_FAILURES) {
      await discord.sendError({ message: `🚨 ${MAX_RPC_FAILURES} consecutive RPC failures — bot may be stuck` });
    }
  }

  let tradeCount = 0;

  // ── Event handler (WebSocket path) ─────────────────────────────────────────
  const eventHandler = new EventHandler(wallet, connection, cfg, () => { tradeCount++; });

  // ── Pool watcher — discovers pools and subscribes ──────────────────────────
  const poolWatcher = new PoolWatcher(connection, (pool) => {
    eventHandler.onPoolUpdate(pool);
  });

  await poolWatcher.start();

  const poolCount = poolWatcher.getPoolCount();
  if (poolCount > 0) {
    logger.info(`⚡ WebSocket active — watching ${poolCount} pool accounts`);
  } else {
    logger.warn('No pools subscribed — running in polling-only mode');
  }

  // ── Polling fallback — scan every 60s regardless of WS events ──────────────
  logger.info('─── Starting polling fallback loop (60s interval) ───');

  let scanNumber = 0;
  let lastTradeCount = 0;

  while (true) {
    scanNumber++;
    const startedAt = Date.now();

    try {
      // USD prices
      const tokens = Object.values(TOKENS);
      const usdPrices = await getUsdPrices(tokens.map(t => t.symbol));
      const tradeSolLamports = BigInt(Math.floor(cfg.tradeSizeSol * 1e9));

      // Circular arb scan (polling path)
      const opps = await scanCircular(tokens, tradeSolLamports, cfg, usdPrices);

      if (opps.length > 0) {
        for (const opp of opps) {
          logger.info(
            `💰 Poll scan: ${opp.token.symbol}→?→${opp.token.symbol} | ` +
            `gross ${opp.profitPct.toFixed(3)}% / $${opp.profitUsd.toFixed(4)} | ` +
            `net ${opp.netProfitPct.toFixed(3)}% / $${opp.netProfitUsd.toFixed(4)} | ` +
            `Route: ${opp.route}`
          );
        }

        const best = opps[0];
        if (!cfg.dryRun) {
          const tradeSolLam = BigInt(Math.floor(cfg.tradeSizeSol * 1e9));
          const ok = await hasEnoughBalance(wallet, connection, tradeSolLam);
          if (ok) {
            const result = await executeCircular(best, wallet, connection, cfg);
            if (result.success) {
              tradeCount++;
              logger.info(`✅ Poll-scan arb complete: ${result.leg1Sig}`);
              consecutiveExecutionFailures = 0;
            } else {
              logger.warn(`❌ Poll-scan execution failed: ${result.error}`);
              consecutiveExecutionFailures++;
              if (consecutiveExecutionFailures >= MAX_EXECUTION_FAILURES) {
                await discord.sendError({ message: `🚨 ${MAX_EXECUTION_FAILURES} consecutive execution failures — check Jito/RPC health` });
              }
            }
          }
        } else {
          logger.info(`🧪 DRY RUN — would execute: ${best.token.symbol} round-trip`);
        }
      }

      // Alert on missed opportunities above threshold
      const highValueOpps = opps.filter(o => o.netProfitUsd >= cfg.minProfitUsd * 2);
      if (highValueOpps.length > 0 && cfg.dryRun) {
        await discord.sendError({ message: `💡 ${highValueOpps.length} high-value opp(s) missed (dry-run): best $${highValueOpps[0].netProfitUsd.toFixed(4)}` });
      }

      const wsStats = eventHandler.getStats();
      const newTrades = tradeCount - lastTradeCount;
      lastTradeCount = tradeCount;

      logger.info(
        `Scan #${scanNumber} done in ${Date.now() - startedAt}ms — ` +
        `poll opps: ${opps.length} | ws trades: ${wsStats.executions} | total trades: ${tradeCount}`
      );
      consecutiveRpcFailures = 0;
    } catch (err) {
      logger.error(`Scan #${scanNumber} crashed`, err);
      consecutiveRpcFailures++;
      if (consecutiveRpcFailures >= MAX_RPC_FAILURES) {
        await discord.sendError({ message: `🚨 ${MAX_RPC_FAILURES} consecutive scan crashes — check RPC health` });
      }
    }

    // 60s heartbeat
    await new Promise(r => setTimeout(r, 60_000));
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('Shutting down...');
  process.exit(0);
});

main().catch(err => {
  logger.error('Fatal error', err);
  process.exit(1);
});