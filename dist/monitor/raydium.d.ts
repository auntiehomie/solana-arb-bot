/**
 * Raydium price checker.
 *
 * Strategy: fetch Raydium CLMM pool list, find pools matching our token pairs,
 * compute an effective swap price from pool state (sqrtPriceX64).
 *
 * As a simpler fallback we also use the Jupiter router restricted to Raydium.
 */
import { DexQuote, Token } from '../types';
/**
 * Get Raydium price for inputToken → outputToken.
 * Returns null on failure.
 */
export declare function fetchRaydiumQuote(inputToken: Token, outputToken: Token, inputAmountLamports: bigint, slippageBps: number): Promise<DexQuote | null>;
//# sourceMappingURL=raydium.d.ts.map