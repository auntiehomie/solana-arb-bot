"use strict";
/**
 * Raydium price checker.
 *
 * Strategy: fetch Raydium CLMM pool list, find pools matching our token pairs,
 * compute an effective swap price from pool state (sqrtPriceX64).
 *
 * As a simpler fallback we also use the Jupiter router restricted to Raydium.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchRaydiumQuote = fetchRaydiumQuote;
const axios_1 = __importDefault(require("axios"));
const jupiter_1 = require("./jupiter");
const logger_1 = require("../utils/logger");
const RAYDIUM_POOL_API = 'https://api.raydium.io/v2/ammV3/ammPools';
// Cache pools for 60 s to reduce API load
let poolCache = [];
let poolCacheAt = 0;
const POOL_CACHE_TTL = 60_000;
async function getRaydiumPools() {
    const now = Date.now();
    if (poolCache.length > 0 && now - poolCacheAt < POOL_CACHE_TTL) {
        return poolCache;
    }
    try {
        const resp = await axios_1.default.get(RAYDIUM_POOL_API, {
            timeout: 10_000,
        });
        poolCache = resp.data?.data ?? [];
        poolCacheAt = now;
        return poolCache;
    }
    catch (err) {
        const axiosErr = err;
        if (axiosErr.response?.status === 429) {
            logger_1.logger.warn('Raydium API rate-limited, using stale cache');
        }
        else {
            logger_1.logger.debug('Raydium pool fetch failed', err);
        }
        return poolCache; // stale
    }
}
function findPool(pools, mintA, mintB) {
    return pools.find((p) => (p.mintA.address === mintA && p.mintB.address === mintB) ||
        (p.mintA.address === mintB && p.mintB.address === mintA));
}
/**
 * Get Raydium price for inputToken → outputToken.
 * Returns null on failure.
 */
async function fetchRaydiumQuote(inputToken, outputToken, inputAmountLamports, slippageBps) {
    // First try: direct pool price from Raydium API
    try {
        const pools = await getRaydiumPools();
        const pool = findPool(pools, inputToken.mint, outputToken.mint);
        if (pool) {
            // Determine direction
            const isForward = pool.mintA.address === inputToken.mint;
            const poolPrice = isForward ? pool.price : 1 / pool.price;
            const inputHuman = Number(inputAmountLamports) / Math.pow(10, inputToken.decimals);
            const outputHuman = inputHuman * poolPrice;
            const outputLamports = BigInt(Math.floor(outputHuman * Math.pow(10, outputToken.decimals)));
            return {
                dex: 'Raydium',
                inputMint: inputToken.mint,
                outputMint: outputToken.mint,
                inputAmount: inputAmountLamports,
                outputAmount: outputLamports,
                price: poolPrice,
                raw: pool,
                fetchedAt: Date.now(),
            };
        }
    }
    catch (err) {
        logger_1.logger.debug('Raydium direct price failed, falling back to Jupiter router', err);
    }
    // Fallback: use Jupiter router restricted to Raydium CLMM / AMM
    const raw = await (0, jupiter_1.fetchJupiterQuoteViaDex)(inputToken, outputToken, inputAmountLamports, slippageBps, 'Raydium CLMM');
    if (!raw) {
        // Try Raydium (legacy AMM)
        const raw2 = await (0, jupiter_1.fetchJupiterQuoteViaDex)(inputToken, outputToken, inputAmountLamports, slippageBps, 'Raydium');
        if (!raw2)
            return null;
        const inputAmt = BigInt(raw2.inAmount);
        const outputAmt = BigInt(raw2.outAmount);
        const inputHuman = Number(inputAmt) / Math.pow(10, inputToken.decimals);
        const outputHuman = Number(outputAmt) / Math.pow(10, outputToken.decimals);
        return {
            dex: 'Raydium',
            inputMint: inputToken.mint,
            outputMint: outputToken.mint,
            inputAmount: inputAmt,
            outputAmount: outputAmt,
            price: outputHuman / inputHuman,
            raw: raw2,
            fetchedAt: Date.now(),
        };
    }
    const inputAmt = BigInt(raw.inAmount);
    const outputAmt = BigInt(raw.outAmount);
    const inputHuman = Number(inputAmt) / Math.pow(10, inputToken.decimals);
    const outputHuman = Number(outputAmt) / Math.pow(10, outputToken.decimals);
    return {
        dex: 'Raydium',
        inputMint: inputToken.mint,
        outputMint: outputToken.mint,
        inputAmount: inputAmt,
        outputAmount: outputAmt,
        price: outputHuman / inputHuman,
        raw,
        fetchedAt: Date.now(),
    };
}
//# sourceMappingURL=raydium.js.map