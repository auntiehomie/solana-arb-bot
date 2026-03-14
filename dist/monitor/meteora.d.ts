/**
 * Meteora DLMM price checker.
 *
 * Fetches all DLMM pairs from Meteora's public API, finds relevant pools,
 * and derives a price. Falls back to Jupiter router restricted to Meteora.
 */
import { DexQuote, Token } from '../types';
export declare function fetchMeteoraQuote(inputToken: Token, outputToken: Token, inputAmountLamports: bigint, slippageBps: number): Promise<DexQuote | null>;
//# sourceMappingURL=meteora.d.ts.map