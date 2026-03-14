"use strict";
/**
 * Cross-DEX arbitrage opportunity scanner.
 *
 * For each token pair, compare quotes across DEXes and flag opportunities
 * where buying on the cheaper DEX and selling on the more expensive one
 * yields a net profit above thresholds.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanOpportunities = scanOpportunities;
const crypto_1 = __importDefault(require("crypto"));
const types_1 = require("../types");
const logger_1 = require("../utils/logger");
const prices_1 = require("../utils/prices");
// Anything above this is almost certainly a stale/spot-price artifact, not real arb
const MAX_REALISTIC_PROFIT_PCT = 10;
/**
 * Given quotes from multiple DEXes for the same pair, find all profitable
 * buy-on-A / sell-on-B combinations.
 */
function scanOpportunities(pairQuotesList, usdPrices, cfg) {
    const opportunities = [];
    for (const pairQuotes of pairQuotesList) {
        const { inputSymbol, outputSymbol, quotes } = pairQuotes;
        if (quotes.length < 2)
            continue;
        const inputToken = types_1.TOKENS[inputSymbol];
        const outputToken = types_1.TOKENS[outputSymbol];
        if (!inputToken || !outputToken)
            continue;
        const inputUsdPrice = usdPrices[inputSymbol] ?? 0;
        // Compare every (buy DEX, sell DEX) pair
        for (let i = 0; i < quotes.length; i++) {
            for (let j = 0; j < quotes.length; j++) {
                if (i === j)
                    continue;
                const buyQuote = quotes[i]; // buy outputToken with inputToken
                const sellQuote = quotes[j]; // sell outputToken back for inputToken
                // Sanity checks
                if (buyQuote.outputAmount <= 0n)
                    continue;
                if (sellQuote.price <= 0)
                    continue;
                // Simulate: spend inputAmount on buyQuote → get outputAmount of outputToken
                // Then on sellQuote, treat outputAmount as "sell" amount by using price inversion:
                //   sell outputToken → inputToken at sellQuote's (inverted) price
                //
                // sellQuote is also quoted as inputToken→outputToken, so its price = outputHuman/inputHuman
                // To sell outputToken→inputToken the price is 1/sellQuote.price (inputToken per outputToken)
                //
                // Expected return from selling buyQuote.outputAmount of outputToken:
                //   return (inputToken units) = buyQuote.outputAmount * (1 / sellQuote.price)
                //
                // But we need to compare in raw units (lamports), so:
                //   returnInputLamports = buyOutputLamports * inputDecimals / outputDecimals / sellQuote.price
                const buyOutputHuman = Number(buyQuote.outputAmount) / Math.pow(10, outputToken.decimals);
                const returnInputHuman = buyOutputHuman / sellQuote.price;
                const returnInputLamports = BigInt(Math.floor(returnInputHuman * Math.pow(10, inputToken.decimals)));
                const inputAmt = buyQuote.inputAmount;
                if (returnInputLamports <= inputAmt)
                    continue; // no profit
                const profitLamports = returnInputLamports - inputAmt;
                const profitPct = (Number(profitLamports) / Number(inputAmt)) * 100;
                const profitUsd = inputUsdPrice > 0
                    ? (0, prices_1.toUsd)(profitLamports, inputToken.decimals, inputUsdPrice)
                    : 0;
                if (profitPct < cfg.minProfitPct && profitUsd < cfg.minProfitUsd) {
                    continue;
                }
                // Sanity check: profits above MAX_REALISTIC_PROFIT_PCT are almost always
                // an artifact of stale pool spot prices not accounting for price impact.
                // Skip them to avoid fake signals.
                if (profitPct > MAX_REALISTIC_PROFIT_PCT) {
                    logger_1.logger.debug(`⚠️  Skipping suspicious ${profitPct.toFixed(2)}% opportunity ` +
                        `(${inputSymbol}→${outputSymbol} ${buyQuote.dex}→${sellQuote.dex}) — ` +
                        `likely pool spot price artifact`);
                    continue;
                }
                const opp = {
                    id: crypto_1.default.randomUUID(),
                    inputSymbol,
                    outputSymbol,
                    buyDex: buyQuote.dex,
                    sellDex: sellQuote.dex,
                    buyQuote,
                    sellQuote,
                    inputAmount: inputAmt,
                    expectedOutputAfterSell: returnInputLamports,
                    profitAmount: profitLamports,
                    profitPct,
                    profitUsd,
                    detectedAt: Date.now(),
                };
                opportunities.push(opp);
                logger_1.logger.info(`💰 Opportunity: ${inputSymbol}→${outputSymbol}→${inputSymbol}` +
                    ` | Buy on ${buyQuote.dex}, sell on ${sellQuote.dex}` +
                    ` | Profit: ${profitPct.toFixed(3)}% / $${profitUsd.toFixed(4)}`);
            }
        }
    }
    // Sort by USD profit descending (fall back to pct)
    opportunities.sort((a, b) => {
        if (b.profitUsd !== a.profitUsd)
            return b.profitUsd - a.profitUsd;
        return b.profitPct - a.profitPct;
    });
    // Deduplicate: keep only best opportunity per (inputSymbol, outputSymbol) pair
    const seen = new Set();
    return opportunities.filter((opp) => {
        const key = `${opp.inputSymbol}:${opp.outputSymbol}`;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
//# sourceMappingURL=opportunities.js.map