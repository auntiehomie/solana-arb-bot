/**
 * Orca Whirlpool price checker.
 *
 * Uses the Orca public API to get pool list, finds matching pools,
 * and derives price from the pool's sqrtPrice or price field.
 * Falls back to Jupiter router restricted to Orca.
 */
import { DexQuote, Token } from '../types';
export declare function fetchOrcaQuote(inputToken: Token, outputToken: Token, inputAmountLamports: bigint, slippageBps: number): Promise<DexQuote | null>;
//# sourceMappingURL=orca.d.ts.map