import { ArbitrageOpportunity, DexQuote, UsdPrices } from '../types';
export interface ScannerConfig {
    minProfitPct: number;
    minProfitUsd: number;
}
/**
 * Scan for triangular arbitrage opportunities.
 * allQuotes is keyed by "INPUT:OUTPUT" and contains DexQuote[] per pair.
 */
export declare function scanTriangularOpportunities(allQuotes: Map<string, DexQuote[]>, usdPrices: UsdPrices, cfg: ScannerConfig): ArbitrageOpportunity[];
//# sourceMappingURL=triangular.d.ts.map