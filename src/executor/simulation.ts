/**
 * Pre-flight transaction simulation.
 *
 * Runs simulateTransaction before execution to validate that a trade would
 * succeed. This catches slippage errors, insufficient funds, and other
 * common failure modes before paying bundle/priority fees.
 */

import {
  Connection,
  VersionedTransaction,
} from '@solana/web3.js';
import { logger } from '../utils/logger';

export interface SimulationResult {
  success: boolean;
  error?: string;
  logs?: string[];
  unitsConsumed?: number;
}

/**
 * Simulate a base64-encoded signed VersionedTransaction.
 * Uses replaceRecentBlockhash to avoid "blockhash not found" errors.
 * Returns detailed simulation results for diagnostics.
 */
export async function simulateTransaction(
  txBase64: string,
  connection: Connection,
  label: string
): Promise<SimulationResult> {
  const txBytes = Buffer.from(txBase64, 'base64');
  const tx = VersionedTransaction.deserialize(txBytes);

  try {
    const sim = await connection.simulateTransaction(tx, {
      sigVerify: true,
      replaceRecentBlockhash: true,
      commitment: 'processed',
    });

    if (sim.value.err) {
      const errStr = JSON.stringify(sim.value.err);
      const isSlippage =
        errStr.includes('6025') ||
        errStr.includes('6024') ||
        errStr.includes('6001') ||
        errStr.includes('6000');

      return {
        success: false,
        error: isSlippage ? `Slippage: ${errStr}` : errStr,
        logs: sim.value.logs ?? undefined,
        unitsConsumed: sim.value.unitsConsumed ?? undefined,
      };
    }

    logger.debug(
      `${label} simulation OK (${sim.value.unitsConsumed ?? '?'} CU)`
    );

    return {
      success: true,
      logs: sim.value.logs ?? undefined,
      unitsConsumed: sim.value.unitsConsumed ?? undefined,
    };
  } catch (err) {
    const msg = (err as Error).message;

    // Node may not support simulation — don't block the trade
    if (msg.includes('simulateTransaction') || msg.includes('not supported')) {
      logger.warn(`[${label}] simulateTransaction not supported by RPC, skipping simulation`);
      return { success: true }; // let the trade proceed
    }

    logger.warn(`[${label}] Simulation error: ${msg}`);
    // Unknown error — let the trade proceed rather than blocking
    return { success: true };
  }
}

/**
 * Simulate both legs of a circular arb trade.
 * Returns false if either leg would fail, true if both ok.
 */
export async function simulateTradePair(
  leg1Tx: string,
  leg2Tx: string,
  connection: Connection
): Promise<{ safe: boolean; leg1: SimulationResult; leg2: SimulationResult }> {
  const [leg1, leg2] = await Promise.all([
    simulateTransaction(leg1Tx, connection, 'Sim-Leg1(buy)'),
    simulateTransaction(leg2Tx, connection, 'Sim-Leg2(sell)'),
  ]);

  const safe = leg1.success && leg2.success;

  if (!safe) {
    const failLeg = !leg1.success ? 'Leg1(buy)' : 'Leg2(sell)';
    const failReason = !leg1.success ? leg1.error : leg2.error;
    logger.warn(
      `⚠️  Pre-flight simulation failed: ${failLeg} — ${failReason}. Skipping trade.`
    );
  }

  return { safe, leg1, leg2 };
}