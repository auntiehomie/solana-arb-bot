"use strict";
/**
 * Jupiter v6 quote fetcher.
 *
 * We use Jupiter both as a DEX source (its own aggregated best route)
 * and to get per-DEX quotes via the `dexes` filter param.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setJupiterApiKey = setJupiterApiKey;
exports.fetchJupiterQuote = fetchJupiterQuote;
exports.fetchJupiterQuoteViaDex = fetchJupiterQuoteViaDex;
const axios_1 = __importDefault(require("axios"));
const logger_1 = require("../utils/logger");
const QUOTE_URL = 'https://quote-api.jup.ag/v6/quote';
let _jupiterApiKey = '';
function setJupiterApiKey(key) {
    _jupiterApiKey = key;
}
function jupiterHeaders() {
    return _jupiterApiKey ? { 'x-api-key': _jupiterApiKey } : {};
}
async function fetchWithBackoff(url, params, retries = 3) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const resp = await axios_1.default.get(url, { params, timeout: 8000, headers: jupiterHeaders() });
            return resp.data;
        }
        catch (err) {
            const axiosErr = err;
            const status = axiosErr.response?.status;
            if (status === 429 && attempt < retries) {
                const delay = Math.pow(2, attempt) * 500;
                logger_1.logger.warn(`Jupiter rate-limited, retrying in ${delay}ms (attempt ${attempt + 1})`);
                await sleep(delay);
                continue;
            }
            throw err;
        }
    }
    throw new Error('Exhausted retries');
}
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
/**
 * Fetch a Jupiter quote (best route, which may itself be multi-DEX).
 * Returns null if no route found or on error.
 */
async function fetchJupiterQuote(inputToken, outputToken, inputAmountLamports, slippageBps) {
    try {
        const data = await fetchWithBackoff(QUOTE_URL, {
            inputMint: inputToken.mint,
            outputMint: outputToken.mint,
            amount: inputAmountLamports.toString(),
            slippageBps,
            onlyDirectRoutes: false,
        });
        if (!data?.outAmount)
            return null;
        const inputAmt = BigInt(data.inAmount);
        const outputAmt = BigInt(data.outAmount);
        // Price in output-token per input-token (human units)
        const inputHuman = Number(inputAmt) / Math.pow(10, inputToken.decimals);
        const outputHuman = Number(outputAmt) / Math.pow(10, outputToken.decimals);
        const price = outputHuman / inputHuman;
        return {
            dex: 'Jupiter',
            inputMint: inputToken.mint,
            outputMint: outputToken.mint,
            inputAmount: inputAmt,
            outputAmount: outputAmt,
            price,
            raw: data,
            fetchedAt: Date.now(),
        };
    }
    catch (err) {
        logger_1.logger.debug(`Jupiter quote failed [${inputToken.symbol}→${outputToken.symbol}]`, err);
        return null;
    }
}
/**
 * Fetch Jupiter quotes specifically routing through a target DEX label.
 * Useful to isolate Raydium/Orca/Meteora pricing via the Jupiter router.
 */
async function fetchJupiterQuoteViaDex(inputToken, outputToken, inputAmountLamports, slippageBps, dexLabel) {
    try {
        const data = await fetchWithBackoff(QUOTE_URL, {
            inputMint: inputToken.mint,
            outputMint: outputToken.mint,
            amount: inputAmountLamports.toString(),
            slippageBps,
            onlyDirectRoutes: true,
            dexes: dexLabel,
        });
        return data ?? null;
    }
    catch (err) {
        logger_1.logger.debug(`Jupiter quote via ${dexLabel} failed`, err);
        return null;
    }
}
//# sourceMappingURL=jupiter.js.map