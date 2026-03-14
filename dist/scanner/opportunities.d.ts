/**
 * Cross-DEX arbitrage opportunity scanner.
 *
 * For each token pair, compare quotes across DEXes and flag opportunities
 * where buying on the cheaper DEX and selling on the more expensive one
 * yields a net profit above thresholds.
 */
import { ArbitrageOpportunity, PairQuotes, UsdPrices } from '../types';
export interface ScannerConfig {
    minProfitPct: number;
    minProfitUsd: number;
}
/**
 * Given quotes from multiple DEXes for the same pair, find all profitable
 * buy-on-A / sell-on-B combinations.
 */
export declare function scanOpportunities(pairQuotesList: PairQuotes[], usdPrices: UsdPrices, cfg: ScannerConfig): ArbitrageOpportunity[];
//# sourceMappingURL=opportunities.d.ts.map