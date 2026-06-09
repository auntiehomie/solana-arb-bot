"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanTriangularOpportunities = scanTriangularOpportunities;
const crypto_1 = __importDefault(require("crypto"));
const types_1 = require("../types");
const logger_1 = require("../utils/logger");
const MAX_REALISTIC_PROFIT_PCT = 15;
// All tokens that can appear in triangular routes
const TRI_TOKENS = ['SOL', 'JUP', 'PENGU', 'BONK', 'USDC'];
/**
 * Generate all unique 3-token circular routes: A→B→C→A
 */
function generateTriRoutes() {
    const routes = [];
    for (let i = 0; i < TRI_TOKENS.length; i++) {
        for (let j = 0; j < TRI_TOKENS.length; j++) {
            if (j === i)
                continue;
            for (let k = 0; k < TRI_TOKENS.length; k++) {
                if (k === i || k === j)
                    continue;
                routes.push([TRI_TOKENS[i], TRI_TOKENS[j], TRI_TOKENS[k]]);
            }
        }
    }
    return routes;
}
/**
 * Find the best quote (highest output) for a given pair from a quotes map.
 */
function bestQuote(allQuotes, inputSymbol, outputSymbol) {
    const key = `${inputSymbol}:${outputSymbol}`;
    const quotes = allQuotes.get(key);
    if (!quotes || quotes.length === 0)
        return null;
    // Pick the quote with highest outputAmount
    return quotes.reduce((best, q) => (q.outputAmount > best.outputAmount ? q : best));
}
/**
 * Scan for triangular arbitrage opportunities.
 * allQuotes is keyed by "INPUT:OUTPUT" and contains DexQuote[] per pair.
 */
function scanTriangularOpportunities(allQuotes, usdPrices, cfg) {
    const opportunities = [];
    const routes = generateTriRoutes();
    for (const [a, b, c] of routes) {
        const leg1 = bestQuote(allQuotes, a, b);
        const leg2 = bestQuote(allQuotes, b, c);
        const leg3 = bestQuote(allQuotes, c, a);
        if (!leg1 || !leg2 || !leg3)
            continue;
        const tokenA = types_1.TOKENS[a];
        const tokenB = types_1.TOKENS[b];
        const tokenC = types_1.TOKENS[c];
        if (!tokenA || !tokenB || !tokenC)
            continue;
        // Calculate chain: start with leg1.inputAmount of A
        // leg1: inputAmount(A) → leg1.outputAmount(B)
        // But leg2 and leg3 quotes were fetched for potentially different input amounts.
        // We need to scale proportionally.
        // leg1 gives us outputAmount of B for inputAmount of A
        const leg1OutHuman = Number(leg1.outputAmount) / Math.pow(10, tokenB.decimals);
        // leg2: how much C do we get for leg1OutHuman of B?
        // Scale: leg2 was quoted for leg2.inputAmount of B → leg2.outputAmount of C
        const leg2InHuman = Number(leg2.inputAmount) / Math.pow(10, tokenB.decimals);
        const leg2OutHuman = Number(leg2.outputAmount) / Math.pow(10, tokenC.decimals);
        if (leg2InHuman === 0)
            continue;
        const leg2Ratio = leg2OutHuman / leg2InHuman; // C per B
        const weGetC = leg1OutHuman * leg2Ratio;
        // leg3: how much A do we get for weGetC of C?
        const leg3InHuman = Number(leg3.inputAmount) / Math.pow(10, tokenC.decimals);
        const leg3OutHuman = Number(leg3.outputAmount) / Math.pow(10, tokenA.decimals);
        if (leg3InHuman === 0)
            continue;
        const leg3Ratio = leg3OutHuman / leg3InHuman; // A per C
        const weGetA = weGetC * leg3Ratio;
        // Started with leg1.inputAmount of A, ended with weGetA of A
        const startedHuman = Number(leg1.inputAmount) / Math.pow(10, tokenA.decimals);
        if (startedHuman === 0)
            continue;
        const profitHuman = weGetA - startedHuman;
        const profitPct = (profitHuman / startedHuman) * 100;
        if (profitPct <= 0)
            continue;
        if (profitPct > MAX_REALISTIC_PROFIT_PCT) {
            logger_1.logger.debug(`⚠️ Skipping suspicious triangular ${a}→${b}→${c}→${a} at ${profitPct.toFixed(2)}%`);
            continue;
        }
        const aUsdPrice = usdPrices[a] ?? 0;
        const profitUsd = profitHuman * aUsdPrice;
        if (profitPct < cfg.minProfitPct && profitUsd < cfg.minProfitUsd)
            continue;
        const profitLamports = BigInt(Math.floor(profitHuman * Math.pow(10, tokenA.decimals)));
        const path = `${a}→${b}→${c}→${a}`;
        const opp = {
            id: crypto_1.default.randomUUID(),
            inputSymbol: a,
            outputSymbol: a, // circular — ends where it started
            buyDex: leg1.dex,
            sellDex: leg3.dex,
            buyQuote: leg1,
            sellQuote: leg3,
            inputAmount: leg1.inputAmount,
            expectedOutputAfterSell: BigInt(Math.floor(weGetA * Math.pow(10, tokenA.decimals))),
            profitAmount: profitLamports,
            profitPct,
            profitUsd,
            detectedAt: Date.now(),
            isTriangular: true,
            triangularPath: path,
            triangularLegs: [leg1, leg2, leg3],
        };
        opportunities.push(opp);
        logger_1.logger.info(`🔺 Triangular: ${path} | ${leg1.dex}→${leg2.dex}→${leg3.dex} | ${profitPct.toFixed(3)}% / $${profitUsd.toFixed(4)}`);
    }
    opportunities.sort((a, b) => {
        if (b.profitUsd !== a.profitUsd)
            return b.profitUsd - a.profitUsd;
        return b.profitPct - a.profitPct;
    });
    return opportunities;
}
//# sourceMappingURL=triangular.js.map