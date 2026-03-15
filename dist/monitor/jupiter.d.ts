/**
 * Jupiter v6 quote fetcher.
 *
 * We use Jupiter both as a DEX source (its own aggregated best route)
 * and to get per-DEX quotes via the `dexes` filter param.
 */
import { DexQuote, Token } from '../types';
export declare function setJupiterApiKey(key: string): void;
export interface JupiterQuoteResponse {
    inputMint: string;
    inAmount: string;
    outputMint: string;
    outAmount: string;
    otherAmountThreshold: string;
    swapMode: string;
    slippageBps: number;
    platformFee: null | unknown;
    priceImpactPct: string;
    routePlan: unknown[];
    contextSlot?: number;
    timeTaken?: number;
}
/**
 * Fetch a Jupiter quote (best route, which may itself be multi-DEX).
 * Returns null if no route found or on error.
 */
export declare function fetchJupiterQuote(inputToken: Token, outputToken: Token, inputAmountLamports: bigint, slippageBps: number): Promise<DexQuote | null>;
/**
 * Fetch Jupiter quotes specifically routing through a target DEX label.
 * Useful to isolate Raydium/Orca/Meteora pricing via the Jupiter router.
 */
export declare function fetchJupiterQuoteViaDex(inputToken: Token, outputToken: Token, inputAmountLamports: bigint, slippageBps: number, dexLabel: string): Promise<JupiterQuoteResponse | null>;
//# sourceMappingURL=jupiter.d.ts.map