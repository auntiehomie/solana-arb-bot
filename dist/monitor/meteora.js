"use strict";
/**
 * Meteora DLMM price checker.
 *
 * Fetches all DLMM pairs from Meteora's public API, finds relevant pools,
 * and derives a price. Falls back to Jupiter router restricted to Meteora.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchMeteoraQuote = fetchMeteoraQuote;
const axios_1 = __importDefault(require("axios"));
const jupiter_1 = require("./jupiter");
const logger_1 = require("../utils/logger");
const METEORA_PAIR_API = 'https://dlmm-api.meteora.ag/pair/all';
let pairCache = [];
let pairCacheAt = 0;
const PAIR_CACHE_TTL = 15_000;
async function getMeteoraPairs() {
    const now = Date.now();
    if (pairCache.length > 0 && now - pairCacheAt < PAIR_CACHE_TTL) {
        return pairCache;
    }
    try {
        const resp = await axios_1.default.get(METEORA_PAIR_API, {
            timeout: 10_000,
        });
        pairCache = Array.isArray(resp.data) ? resp.data : [];
        pairCacheAt = now;
        return pairCache;
    }
    catch (err) {
        const axiosErr = err;
        if (axiosErr.response?.status === 429) {
            logger_1.logger.warn('Meteora API rate-limited, using stale pair cache');
        }
        else {
            logger_1.logger.debug('Meteora pair fetch failed', err);
        }
        return pairCache;
    }
}
function findMeteoraPair(pairs, mintA, mintB) {
    const matches = pairs
        .filter((p) => (p.mint_x === mintA && p.mint_y === mintB) ||
        (p.mint_x === mintB && p.mint_y === mintA))
        .sort((a, b) => (b.liquidity ?? 0) - (a.liquidity ?? 0));
    return matches[0];
}
async function fetchMeteoraQuote(inputToken, outputToken, inputAmountLamports, slippageBps) {
    // Primary: Jupiter router restricted to Meteora — real execution price with impact
    const raw = await (0, jupiter_1.fetchJupiterQuoteViaDex)(inputToken, outputToken, inputAmountLamports, slippageBps, 'Meteora DLMM');
    if (!raw) {
        const raw2 = await (0, jupiter_1.fetchJupiterQuoteViaDex)(inputToken, outputToken, inputAmountLamports, slippageBps, 'Meteora');
        if (!raw2) {
            // Last resort: direct Meteora pool spot price
            try {
                const pairs = await getMeteoraPairs();
                const pair = findMeteoraPair(pairs, inputToken.mint, outputToken.mint);
                if (pair) {
                    const isForward = pair.mint_x === inputToken.mint;
                    const poolPrice = isForward ? pair.current_price : 1 / pair.current_price;
                    const inputHuman = Number(inputAmountLamports) / Math.pow(10, inputToken.decimals);
                    const outputHuman = inputHuman * poolPrice;
                    const outputLamports = BigInt(Math.floor(outputHuman * Math.pow(10, outputToken.decimals)));
                    return {
                        dex: 'Meteora',
                        inputMint: inputToken.mint,
                        outputMint: outputToken.mint,
                        inputAmount: inputAmountLamports,
                        outputAmount: outputLamports,
                        price: poolPrice,
                        raw: pair,
                        fetchedAt: Date.now(),
                    };
                }
            }
            catch (err) {
                logger_1.logger.debug('Meteora fallback pool price also failed', err);
            }
            return null;
        }
        const inputAmt = BigInt(raw2.inAmount);
        const outputAmt = BigInt(raw2.outAmount);
        const inputHuman = Number(inputAmt) / Math.pow(10, inputToken.decimals);
        const outputHuman = Number(outputAmt) / Math.pow(10, outputToken.decimals);
        return {
            dex: 'Meteora',
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
        dex: 'Meteora',
        inputMint: inputToken.mint,
        outputMint: outputToken.mint,
        inputAmount: inputAmt,
        outputAmount: outputAmt,
        price: outputHuman / inputHuman,
        raw,
        fetchedAt: Date.now(),
    };
}
//# sourceMappingURL=meteora.js.map