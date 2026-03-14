/**
 * Transaction builder for arbitrage legs.
 *
 * Uses Jupiter swap API to construct versioned transactions for each leg.
 * Returns serialized (base64) transactions ready for Jito bundle submission.
 */
import { Connection, Keypair } from '@solana/web3.js';
import { ArbitrageOpportunity } from '../types';
import { Config } from '../config';
export interface BuiltBundle {
    transactions: string[];
    tipLamports: bigint;
}
/**
 * Build the full 3-transaction bundle:
 * [leg1_swap, leg2_swap, tip_tx]
 */
export declare function buildBundle(opp: ArbitrageOpportunity, wallet: Keypair, connection: Connection, cfg: Config): Promise<BuiltBundle | null>;
/**
 * Check that the wallet has enough SOL to execute and keep the minimum reserve.
 * Minimum reserve: 0.05 SOL (50_000_000 lamports).
 */
export declare function hasEnoughBalance(wallet: Keypair, connection: Connection, tradeSizeLamports: bigint): Promise<boolean>;
//# sourceMappingURL=builder.d.ts.map