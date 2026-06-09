"use strict";
/**
 * Raydium price checker — v3 API + Jupiter routing fallback.
 *
 * Strategy (in order):
 *   1. Jupiter router restricted to Raydium routes (most accurate, real price impact)
 *   2. Raydium v3 REST API pool data (CLMM + CPMM) — cached 5 min
 *   3. Stale cache if all else fails
 *
 * Raydium v2 API (/ammV3/ammPools) was heavily rate-limited.
 * Raydium v3 API (api-v3.raydium.io) is the current official endpoint.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchRaydiumQuote = fetchRaydiumQuote;
const axios_1 = __importDefault(require("axios"));
const jupiter_1 = require("./jupiter");
const logger_1 = require("../utils/logger");
// Raydium v3 API — current official endpoint, better rate limits than v2
const RAYDIUM_V3_API = 'https://api-v3.raydium.io/pools/info/list';
// Cache 5 minutes — Raydium pool data doesn't change that fast
let poolCache = [];
let poolCacheAt = 0;
const POOL_CACHE_TTL = 300_000;
let fetchInFlight = false;
// Token mints we care about — pre-filter for efficiency
const WATCHED_MINTS = new Set([
    'So11111111111111111111111111111111111111112', // SOL
    'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', // JUP
    '2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv', // PENGU
    'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // BONK
]);
async function getRaydiumPools() {
    const now = Date.now();
    if (poolCache.length > 0 && now - poolCacheAt < POOL_CACHE_TTL) {
        return poolCache;
    }
    if (fetchInFlight)
        return poolCache; // return stale while fetch is in-flight
    fetchInFlight = true;
    try {
        // Fetch top pools by liquidity — filter to our tokens
        const resp = await axios_1.default.get(RAYDIUM_V3_API, {
            params: {
                poolType: 'all',
                poolSortField: 'liquidity',
                sortType: 'desc',
                pageSize: 100,
                page: 1,
            },
            timeout: 10_000,
        });
        if (resp.data?.success && Array.isArray(resp.data.data?.data)) {
            poolCache = resp.data.data.data.filter((p) => WATCHED_MINTS.has(p.mintA.address) && WATCHED_MINTS.has(p.mintB.address));
            poolCacheAt = now;
            if (poolCache.length > 0) {
                logger_1.logger.info(`[Raydium] v3 cache refreshed — ${poolCache.length} relevant pools`);
            }
        }
        fetchInFlight = false;
        return poolCache;
    }
    catch (err) {
        fetchInFlight = false;
        const axiosErr = err;
        if (axiosErr.response?.status === 429) {
            logger_1.logger.warn('[Raydium] v3 API rate-limited — using stale cache');
        }
        else {
            logger_1.logger.debug('[Raydium] v3 API fetch failed', err.message);
        }
        return poolCache;
    }
}
function findPool(pools, mintA, mintB) {
    return pools
        .filter((p) => (p.mintA.address === mintA && p.mintB.address === mintB) ||
        (p.mintA.address === mintB && p.mintB.address === mintA))
        .sort((a, b) => (b.tvl ?? 0) - (a.tvl ?? 0))[0]; // highest TVL first
}
async function fetchRaydiumQuote(inputToken, outputToken, inputAmountLamports, slippageBps) {
    // ── Primary: Jupiter router restricted to Raydium ─────────────────────────
    // This gives real execution quotes with price impact — far more accurate than
    // pool spot prices. Jupiter knows all Raydium CLMM + CPMM + AMM pools.
    const jupLabels = ['Raydium CLMM', 'Raydium', 'Raydium CP'];
    for (const label of jupLabels) {
        const raw = await (0, jupiter_1.fetchJupiterQuoteViaDex)(inputToken, outputToken, inputAmountLamports, slippageBps, label);
        if (raw) {
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
    }
    // ── Fallback: Raydium v3 pool spot price ──────────────────────────────────
    // Less accurate (no price impact) but better than nothing.
    // Sanity cap in scanner (10%) will filter fake spreads from spot prices.
    try {
        const pools = await getRaydiumPools();
        const pool = findPool(pools, inputToken.mint, outputToken.mint);
        if (pool) {
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
        logger_1.logger.debug('[Raydium] pool price fallback failed', err.message);
    }
    return null;
}
//# sourceMappingURL=raydium.js.map