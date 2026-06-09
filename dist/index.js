"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = require("./utils/logger");
const types_1 = require("./types");
const opportunities_1 = require("./scanner/opportunities");
+;
const triangular_1 = require("./scanner/triangular");
+
// ─── Simulated P&L tracking (dry run) ─────────────────────────────────────────
let;
simulatedPnlUsd = 0;
const PAIRS = [
];
- - -;
const opps = (0, opportunities_1.scanOpportunities)(pairQuotesList, usdPrices, {}
    - minProfitPct, cfg.minProfitPct, -minProfitUsd, cfg.minProfitUsd, -);
;
+ +;
const pairQuotesList = [];
+;
for (const tradeSizeSol of cfg.tradeSizes) {
    +;
    const tradeSizeLamports = BigInt(Math.floor(tradeSizeSol * Math.pow(10, types_1.TOKENS.SOL.decimals)));
    + +;
    const quoteResults = await Promise.allSettled(+PAIRS.map(async (pair) => {
        +let;
        inputAmt: bigint;
        +;
        if (pair.input.symbol === 'SOL') {
            +inputAmt;
            tradeSizeLamports;
            +;
        }
        else {
            +;
            const solUsd = usdPrices['SOL'] ?? 0;
            +;
            const tokenUsd = usdPrices[pair.input.symbol] ?? 0;
            +;
            if (tokenUsd === 0 || solUsd === 0) {
                +inputAmt;
                BigInt(1000) * BigInt(Math.pow(10, pair.input.decimals));
                +;
            }
            else {
                +;
                const humanAmt = (tradeSizeSol * solUsd) / tokenUsd;
                +inputAmt;
                BigInt(Math.floor(humanAmt * Math.pow(10, pair.input.decimals)));
                +;
            }
            +;
        }
        + +;
        const { quotes, errors } = await fetchAllQuotesForPair(+pair, +inputAmt, +cfg.maxSlippageBps
            + );
        +allErrors.push(...errors);
        +;
        return { pair, quotes, inputAmt };
        +;
    })
        + );
    + +;
    for (const result of quoteResults) {
        +;
        if (result.status === 'rejected') {
            +allErrors.push(`Pair quote batch failed: ${result.reason?.message}`);
            +quotesFailed++;
            +;
            continue;
            +;
        }
        + +;
        const { pair, quotes, inputAmt } = result.value;
        +quotesTotal;
        4; // 4 DEXes per pair
        +quotesFailed;
        4 - quotes.length;
        + +;
        if (quotes.length < 2)
            continue;
        + +pairQuotesList.push({}
            + inputSymbol, pair.input.symbol, +outputSymbol, pair.output.symbol, +quotes, +);
    }
    ;
    +;
}
+;
+ + +;
const allQuotesMap = new Map();
+;
for (const pq of pairQuotesList) {
    +;
    const key = `${pq.inputSymbol}:${pq.outputSymbol}`;
    +allQuotesMap.set(key, pq.quotes);
    +;
}
+;
const triOpps = (0, triangular_1.scanTriangularOpportunities)(allQuotesMap, usdPrices, {}
    + minProfitPct, cfg.minProfitPct, +minProfitUsd, cfg.minProfitUsd, +);
;
+ + +;
const allOpps = [...opps, ...triOpps].sort((a, b) => {
    +;
    if (b.profitUsd !== a.profitUsd)
        return b.profitUsd - a.profitUsd;
    +;
    return b.profitPct - a.profitPct;
    +;
});
- -;
if (opps.length > 0 && !cfg.dryRun) {
    + +;
    if (allOpps.length > 0 && !cfg.dryRun) {
        -;
        const best = opps[0];
        +;
        const best = allOpps[0];
        await executeOpportunity(best, wallet, connection, cfg, rateLimiter);
        tradesExecuted++;
        -;
    }
    else if (opps.length > 0 && cfg.dryRun) {
        +;
    }
    else if (allOpps.length > 0 && cfg.dryRun) {
        // Accumulate simulated P&L from all opportunities found
        for (const opp of opps) {
            simulatedPnlUsd += opp.profitUsd;
        }
        -logger_1.logger.info(`🧪 DRY RUN — would execute: ${opps[0].inputSymbol}→${opps[0].outputSymbol}`);
        +logger_1.logger.info(`🧪 DRY RUN — would execute: ${allOpps[0].inputSymbol}→${allOpps[0].outputSymbol}`);
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
    **  * End;
Patch;
//# sourceMappingURL=index.js.map