"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const web3_js_1 = require("@solana/web3.js");
const bs58_1 = __importDefault(require("bs58"));
const config_1 = require("./config");
const logger_1 = require("./utils/logger");
const prices_1 = require("./utils/prices");
const types_1 = require("./types");
const jupiter_1 = require("./monitor/jupiter");
const raydium_1 = require("./monitor/raydium");
const orca_1 = require("./monitor/orca");
const meteora_1 = require("./monitor/meteora");
const opportunities_1 = require("./scanner/opportunities");
const builder_1 = require("./executor/builder");
const jito_1 = require("./executor/jito");
const PAIRS = [
    { input: types_1.TOKENS.JUP, output: types_1.TOKENS.SOL },
    { input: types_1.TOKENS.PENGU, output: types_1.TOKENS.SOL },
    { input: types_1.TOKENS.BONK, output: types_1.TOKENS.SOL },
    { input: types_1.TOKENS.JUP, output: types_1.TOKENS.BONK },
];
// ─── Rate limiter ─────────────────────────────────────────────────────────────
class RateLimiter {
    maxPerMinute;
    timestamps = [];
    constructor(maxPerMinute) {
        this.maxPerMinute = maxPerMinute;
    }
    canExecute() {
        const now = Date.now();
        const windowStart = now - 60_000;
        this.timestamps = this.timestamps.filter((t) => t > windowStart);
        return this.timestamps.length < this.maxPerMinute;
    }
    record() {
        this.timestamps.push(Date.now());
    }
}
// ─── Quote fetcher ────────────────────────────────────────────────────────────
async function fetchAllQuotesForPair(pair, inputAmountLamports, slippageBps) {
    const { input, output } = pair;
    const errors = [];
    const results = await Promise.allSettled([
        (0, jupiter_1.fetchJupiterQuote)(input, output, inputAmountLamports, slippageBps),
        (0, raydium_1.fetchRaydiumQuote)(input, output, inputAmountLamports, slippageBps),
        (0, orca_1.fetchOrcaQuote)(input, output, inputAmountLamports, slippageBps),
        (0, meteora_1.fetchMeteoraQuote)(input, output, inputAmountLamports, slippageBps),
    ]);
    const quotes = [];
    const dexNames = ['Jupiter', 'Raydium', 'Orca', 'Meteora'];
    for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.status === 'fulfilled' && r.value !== null) {
            quotes.push(r.value);
        }
        else if (r.status === 'rejected') {
            errors.push(`${dexNames[i]}: ${r.reason?.message ?? 'unknown error'}`);
        }
    }
    return { quotes, errors };
}
// ─── Main scan loop ───────────────────────────────────────────────────────────
async function runScan(cfg, wallet, connection, rateLimiter, scanNumber) {
    const startedAt = Date.now();
    const allErrors = [];
    let quotesTotal = 0;
    let quotesFailed = 0;
    let opportunitiesFound = 0;
    let tradesExecuted = 0;
    // ── USD prices ──────────────────────────────────────────────────────────────
    const symbols = Object.keys(types_1.TOKENS);
    const usdPrices = await (0, prices_1.getUsdPrices)(symbols);
    logger_1.logger.debug('USD prices', usdPrices);
    // ── Trade size in input-token lamports ─────────────────────────────────────
    const tradeSizeLamports = BigInt(Math.floor(cfg.tradeSizeSol * Math.pow(10, types_1.TOKENS.SOL.decimals)));
    // ── Fetch all quotes in parallel ────────────────────────────────────────────
    const pairQuotesList = [];
    const quoteResults = await Promise.allSettled(PAIRS.map(async (pair) => {
        // Scale trade size to input token if it's not SOL
        let inputAmt;
        if (pair.input.symbol === 'SOL') {
            inputAmt = tradeSizeLamports;
        }
        else {
            const solUsd = usdPrices['SOL'] ?? 0;
            const tokenUsd = usdPrices[pair.input.symbol] ?? 0;
            if (tokenUsd === 0 || solUsd === 0) {
                // Fallback: use 1000 units of the input token
                inputAmt = BigInt(1000) * BigInt(Math.pow(10, pair.input.decimals));
            }
            else {
                const humanAmt = (cfg.tradeSizeSol * solUsd) / tokenUsd;
                inputAmt = BigInt(Math.floor(humanAmt * Math.pow(10, pair.input.decimals)));
            }
        }
        const { quotes, errors } = await fetchAllQuotesForPair(pair, inputAmt, cfg.maxSlippageBps);
        allErrors.push(...errors);
        return { pair, quotes, inputAmt };
    }));
    for (const result of quoteResults) {
        if (result.status === 'rejected') {
            allErrors.push(`Pair quote batch failed: ${result.reason?.message}`);
            quotesFailed++;
            continue;
        }
        const { pair, quotes, inputAmt } = result.value;
        quotesTotal += 4; // 4 DEXes per pair
        quotesFailed += 4 - quotes.length;
        if (quotes.length < 2)
            continue;
        pairQuotesList.push({
            inputSymbol: pair.input.symbol,
            outputSymbol: pair.output.symbol,
            quotes,
        });
    }
    // ── Scan for opportunities ─────────────────────────────────────────────────
    const opps = (0, opportunities_1.scanOpportunities)(pairQuotesList, usdPrices, {
        minProfitPct: cfg.minProfitPct,
        minProfitUsd: cfg.minProfitUsd,
    });
    opportunitiesFound = opps.length;
    if (opps.length > 0) {
        logger_1.logger.info(`🔍 Scan #${scanNumber}: Found ${opps.length} opportunity(ies)`);
        for (const opp of opps) {
            logger_1.logger.info(`  ↳ ${opp.inputSymbol}→${opp.outputSymbol}: buy@${opp.buyDex} sell@${opp.sellDex}` +
                ` | ${opp.profitPct.toFixed(3)}% / $${opp.profitUsd.toFixed(4)}`);
        }
    }
    else {
        logger_1.logger.debug(`Scan #${scanNumber}: No opportunities`);
    }
    // ── Execute best opportunity ───────────────────────────────────────────────
    if (opps.length > 0 && !cfg.dryRun) {
        const best = opps[0];
        await executeOpportunity(best, wallet, connection, cfg, rateLimiter);
        tradesExecuted++;
    }
    else if (opps.length > 0 && cfg.dryRun) {
        logger_1.logger.info(`🧪 DRY RUN — would execute: ${opps[0].inputSymbol}→${opps[0].outputSymbol}`);
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
async function executeOpportunity(opp, wallet, connection, cfg, rateLimiter) {
    if (!rateLimiter.canExecute()) {
        logger_1.logger.warn('Rate limit reached, skipping execution');
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
    const tradeSizeLamports = BigInt(Math.floor(cfg.tradeSizeSol * Math.pow(10, types_1.TOKENS.SOL.decimals)));
    const sufficientBalance = await (0, builder_1.hasEnoughBalance)(wallet, connection, tradeSizeLamports);
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
    const bundle = await (0, builder_1.buildBundle)(opp, wallet, connection, cfg);
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
    const jitoResult = await (0, jito_1.submitJitoBundle)(bundle.transactions, cfg.jitoUuid);
    rateLimiter.record();
    const result = {
        opportunity: opp,
        bundleId: jitoResult.bundleId,
        success: jitoResult.success,
        dryRun: false,
        error: jitoResult.error,
        executedAt: Date.now(),
        tipLamports: bundle.tipLamports,
    };
    if (jitoResult.success) {
        logger_1.logger.info(`✅ Trade executed! Bundle: ${jitoResult.bundleId}` +
            ` | Tip: ${bundle.tipLamports} lamports` +
            ` | Expected profit: $${opp.profitUsd.toFixed(4)}`);
    }
    else {
        logger_1.logger.error(`❌ Trade failed: ${jitoResult.error}`);
    }
    return result;
}
// ─── Entry point ──────────────────────────────────────────────────────────────
async function main() {
    // Load and validate config
    let cfg;
    try {
        cfg = (0, config_1.loadConfig)();
        (0, config_1.validateConfig)(cfg);
    }
    catch (err) {
        logger_1.logger.error('Config validation failed', err);
        process.exit(1);
    }
    logger_1.logger.info('🚀 Solana Arbitrage Bot starting...');
    logger_1.logger.info(`  Mode: ${cfg.dryRun ? '🧪 DRY RUN' : '🔥 LIVE'}`);
    logger_1.logger.info(`  RPC: ${cfg.rpcUrl}`);
    logger_1.logger.info(`  Trade size: ${cfg.tradeSizeSol} SOL`);
    logger_1.logger.info(`  Min profit: ${cfg.minProfitPct}% or $${cfg.minProfitUsd}`);
    logger_1.logger.info(`  Scan interval: ${cfg.scanIntervalMs}ms`);
    logger_1.logger.info(`  Max trades/min: ${cfg.maxTradesPerMinute}`);
    // Init wallet
    let wallet;
    const isPlaceholderKey = !cfg.walletPrivateKey ||
        cfg.walletPrivateKey === 'your_base58_private_key_here';
    if (isPlaceholderKey && cfg.dryRun) {
        wallet = web3_js_1.Keypair.generate();
        logger_1.logger.warn(`  ⚠️  No wallet key set — using throwaway keypair for DRY RUN only`);
        logger_1.logger.warn(`  Throwaway pubkey: ${wallet.publicKey.toBase58()}`);
        logger_1.logger.warn(`  Set WALLET_PRIVATE_KEY before going live!`);
    }
    else {
        try {
            const secretKey = bs58_1.default.decode(cfg.walletPrivateKey);
            wallet = web3_js_1.Keypair.fromSecretKey(secretKey);
            logger_1.logger.info(`  Wallet: ${wallet.publicKey.toBase58()}`);
        }
        catch (err) {
            logger_1.logger.error('Failed to load wallet from WALLET_PRIVATE_KEY', err);
            process.exit(1);
        }
    }
    // Init connection
    const connection = new web3_js_1.Connection(cfg.rpcUrl, {
        commitment: 'confirmed',
        wsEndpoint: cfg.rpcWsUrl,
    });
    // Check balance on start
    try {
        const balance = await connection.getBalance(wallet.publicKey);
        logger_1.logger.info(`  Balance: ${(balance / 1e9).toFixed(4)} SOL`);
        if (balance < 50_000_000) {
            logger_1.logger.warn('⚠️  Balance below 0.05 SOL minimum reserve');
        }
    }
    catch (err) {
        logger_1.logger.warn('Could not fetch initial balance (RPC may be slow)', err);
    }
    const rateLimiter = new RateLimiter(cfg.maxTradesPerMinute);
    let scanNumber = 0;
    let totalOpportunities = 0;
    let totalTrades = 0;
    logger_1.logger.info('🔄 Starting scan loop...\n');
    // ── Main loop ───────────────────────────────────────────────────────────────
    const runLoop = async () => {
        scanNumber++;
        try {
            const metrics = await runScan(cfg, wallet, connection, rateLimiter, scanNumber);
            totalOpportunities += metrics.opportunitiesFound;
            totalTrades += metrics.tradesExecuted;
            if (scanNumber % 60 === 0) {
                logger_1.logger.info(`📊 Stats: scans=${scanNumber} opps=${totalOpportunities} trades=${totalTrades}` +
                    ` | last scan: ${metrics.durationMs}ms`);
            }
            if (metrics.errors.length > 0) {
                logger_1.logger.debug(`Scan #${scanNumber} errors:`, metrics.errors);
            }
        }
        catch (err) {
            logger_1.logger.error(`Scan #${scanNumber} crashed`, err);
        }
        setTimeout(runLoop, cfg.scanIntervalMs);
    };
    runLoop();
}
// ─── Graceful shutdown ────────────────────────────────────────────────────────
process.on('SIGINT', () => {
    logger_1.logger.info('\n👋 Shutting down gracefully...');
    process.exit(0);
});
process.on('SIGTERM', () => {
    logger_1.logger.info('SIGTERM received, shutting down...');
    process.exit(0);
});
process.on('unhandledRejection', (reason) => {
    logger_1.logger.error('Unhandled promise rejection', reason);
});
main().catch((err) => {
    logger_1.logger.error('Fatal error in main()', err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map