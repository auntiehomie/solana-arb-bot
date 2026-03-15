export interface Token {
    symbol: string;
    mint: string;
    decimals: number;
}
export declare const TOKENS: Record<string, Token>;
export type TokenSymbol = keyof typeof TOKENS;
export type DexName = 'Jupiter' | 'Raydium' | 'Orca' | 'Meteora';
/** A normalised DEX quote */
export interface DexQuote {
    dex: DexName;
    inputMint: string;
    outputMint: string;
    inputAmount: bigint;
    outputAmount: bigint;
    /** Price as outputAmount / inputAmount (already decimal-adjusted) */
    price: number;
    /** Raw API response, kept for swap-transaction building */
    raw?: unknown;
    fetchedAt: number;
}
/** Quotes keyed by dex name for a given pair */
export interface PairQuotes {
    inputSymbol: string;
    outputSymbol: string;
    quotes: DexQuote[];
}
export interface ArbitrageOpportunity {
    id: string;
    inputSymbol: string;
    outputSymbol: string;
    buyDex: DexName;
    sellDex: DexName;
    buyQuote: DexQuote;
    sellQuote: DexQuote;
    /** In token-native units */
    inputAmount: bigint;
    expectedOutputAfterSell: bigint;
    /** Gross profit in input-token units */
    profitAmount: bigint;
    profitPct: number;
    profitUsd: number;
    detectedAt: number;
    isTriangular?: boolean;
    triangularPath?: string;
    triangularLegs?: DexQuote[];
}
export interface JitoBundleRequest {
    jsonrpc: '2.0';
    id: number;
    method: 'sendBundle';
    params: [string[]];
}
export interface JitoBundleResponse {
    jsonrpc: string;
    id: number;
    result?: string;
    error?: {
        code: number;
        message: string;
    };
}
export interface ExecutionResult {
    opportunity: ArbitrageOpportunity;
    bundleId?: string;
    success: boolean;
    dryRun: boolean;
    error?: string;
    executedAt: number;
    tipLamports: bigint;
}
export type UsdPrices = Record<string, number>;
export interface ScanMetrics {
    scanNumber: number;
    startedAt: number;
    completedAt: number;
    durationMs: number;
    quotesTotal: number;
    quotesFailed: number;
    opportunitiesFound: number;
    tradesExecuted: number;
    errors: string[];
}
//# sourceMappingURL=types.d.ts.map