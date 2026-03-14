"use strict";
/**
 * Transaction builder for arbitrage legs.
 *
 * Uses Jupiter swap API to construct versioned transactions for each leg.
 * Returns serialized (base64) transactions ready for Jito bundle submission.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildBundle = buildBundle;
exports.hasEnoughBalance = hasEnoughBalance;
const axios_1 = __importDefault(require("axios"));
const web3_js_1 = require("@solana/web3.js");
const logger_1 = require("../utils/logger");
const SWAP_URL = 'https://quote-api.jup.ag/v6/swap';
/**
 * Build a versioned transaction for a single Jupiter swap leg.
 * Returns base64-encoded transaction or null on failure.
 */
async function buildJupiterSwapTx(quote, wallet, cfg) {
    if (!quote.raw) {
        logger_1.logger.warn('buildJupiterSwapTx: missing raw quote data');
        return null;
    }
    try {
        const body = {
            quoteResponse: quote.raw,
            userPublicKey: wallet.publicKey.toBase58(),
            wrapAndUnwrapSol: true,
            dynamicComputeUnitLimit: true,
        };
        const resp = await axios_1.default.post(SWAP_URL, body, {
            timeout: 10_000,
            headers: { 'Content-Type': 'application/json' },
        });
        const { swapTransaction } = resp.data;
        if (!swapTransaction)
            throw new Error('Empty swapTransaction in response');
        // Decode, sign, and re-encode
        const txBytes = Buffer.from(swapTransaction, 'base64');
        const vTx = web3_js_1.VersionedTransaction.deserialize(txBytes);
        vTx.sign([wallet]);
        return Buffer.from(vTx.serialize()).toString('base64');
    }
    catch (err) {
        logger_1.logger.error('Failed to build Jupiter swap transaction', err);
        return null;
    }
}
/**
 * Build a simple SOL tip transaction to Jito tip account.
 */
function buildTipTransaction(wallet, tipLamports, recentBlockhash, jitoTipAccount) {
    const tx = new web3_js_1.Transaction({
        recentBlockhash,
        feePayer: wallet.publicKey,
    });
    tx.add(web3_js_1.SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: new web3_js_1.PublicKey(jitoTipAccount),
        lamports: Number(tipLamports),
    }));
    tx.sign(wallet);
    return tx.serialize().toString('base64');
}
/**
 * Calculate tip amount: max(minTip, 1% of expected profit in lamports).
 */
function calcTipLamports(opp, cfg) {
    const profitBasedTip = opp.profitAmount / 100n; // 1% of profit
    const minTip = cfg.jitoTipLamports;
    return profitBasedTip > minTip ? profitBasedTip : minTip;
}
/**
 * Build the full 3-transaction bundle:
 * [leg1_swap, leg2_swap, tip_tx]
 */
async function buildBundle(opp, wallet, connection, cfg) {
    logger_1.logger.debug(`Building bundle for opportunity ${opp.id}`);
    // Fetch recent blockhash for tip transaction
    let recentBlockhash;
    try {
        const { blockhash } = await connection.getLatestBlockhash('confirmed');
        recentBlockhash = blockhash;
    }
    catch (err) {
        logger_1.logger.error('Failed to fetch recent blockhash', err);
        return null;
    }
    // Build leg 1: buy on buyDex (quote already fetched — we need a Jupiter swap tx)
    const leg1 = await buildJupiterSwapTx(opp.buyQuote, wallet, cfg);
    if (!leg1) {
        logger_1.logger.warn(`Bundle build failed: leg 1 transaction build error`);
        return null;
    }
    // Build leg 2: sell on sellDex
    // The sell quote is also stored in opp.sellQuote, but as inputToken→outputToken
    // We need to build a swap in the reverse direction:
    // outputToken → inputToken using sellQuote's DEX.
    // Since sellQuote.raw is a Jupiter quote for inputToken→outputToken,
    // we need to fetch a fresh reverse quote for outputToken→inputToken.
    // For now, we use the sellQuote directly if it has raw data, otherwise skip.
    const leg2 = await buildJupiterSwapTx(opp.sellQuote, wallet, cfg);
    if (!leg2) {
        logger_1.logger.warn(`Bundle build failed: leg 2 transaction build error`);
        return null;
    }
    const tipLamports = calcTipLamports(opp, cfg);
    const tipTx = buildTipTransaction(wallet, tipLamports, recentBlockhash, cfg.jitoTipAccount);
    return {
        transactions: [leg1, leg2, tipTx],
        tipLamports,
    };
}
/**
 * Check that the wallet has enough SOL to execute and keep the minimum reserve.
 * Minimum reserve: 0.05 SOL (50_000_000 lamports).
 */
async function hasEnoughBalance(wallet, connection, tradeSizeLamports) {
    const MINIMUM_RESERVE = 50000000n; // 0.05 SOL
    try {
        const balance = BigInt(await connection.getBalance(wallet.publicKey));
        const required = tradeSizeLamports + MINIMUM_RESERVE;
        if (balance < required) {
            logger_1.logger.warn(`Insufficient balance: ${balance} lamports, need ${required} (trade + 0.05 SOL reserve)`);
            return false;
        }
        return true;
    }
    catch (err) {
        logger_1.logger.error('Balance check failed', err);
        return false;
    }
}
//# sourceMappingURL=builder.js.map