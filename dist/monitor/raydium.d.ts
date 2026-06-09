/**
 * Raydium price checker — v3 API + Jupiter routing fallback.
 *
 * Strategy (in order):
 *   1. Jupiter router restricted to Raydium routes (most accurate, real price impact)
 *   2. Raydium v3 REST API pool data (CLMM + CPMM) — cached 5 min
 *   3. Stale cache if all else fails
 *
 * Raydium v2 API (/ammV3/ammPools) was heavily rate-limited.
 * Raydium v3 API (api-v3.raydium.io) is the current official endpoint.
 */
import { DexQuote, Token } from '../types';
export declare function fetchRaydiumQuote(inputToken: Token, outputToken: Token, inputAmountLamports: bigint, slippageBps: number): Promise<DexQuote | null>;
//# sourceMappingURL=raydium.d.ts.map