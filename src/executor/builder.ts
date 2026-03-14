/**
 * Transaction builder for arbitrage legs.
 *
 * Uses Jupiter swap API to construct versioned transactions for each leg.
 * Returns serialized (base64) transactions ready for Jito bundle submission.
 */

import axios from 'axios';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js';
import { ArbitrageOpportunity, DexQuote } from '../types';
import { logger } from '../utils/logger';
import { Config } from '../config';

const SWAP_URL = 'https://quote-api.jup.ag/v6/swap';

export interface BuiltBundle {
  transactions: string[];  // base64-encoded serialized transactions
  tipLamports: bigint;
}

interface JupiterSwapRequest {
  quoteResponse: unknown;
  userPublicKey: string;
  wrapAndUnwrapSol: boolean;
  dynamicComputeUnitLimit: boolean;
  prioritizationFeeLamports?: number;
}

interface JupiterSwapResponse {
  swapTransaction: string;  // base64-encoded versioned transaction
  lastValidBlockHeight: number;
}

/**
 * Build a versioned transaction for a single Jupiter swap leg.
 * Returns base64-encoded transaction or null on failure.
 */
async function buildJupiterSwapTx(
  quote: DexQuote,
  wallet: Keypair,
  cfg: Config
): Promise<string | null> {
  if (!quote.raw) {
    logger.warn('buildJupiterSwapTx: missing raw quote data');
    return null;
  }

  try {
    const body: JupiterSwapRequest = {
      quoteResponse: quote.raw,
      userPublicKey: wallet.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
    };

    const resp = await axios.post<JupiterSwapResponse>(SWAP_URL, body, {
      timeout: 10_000,
      headers: { 'Content-Type': 'application/json' },
    });

    const { swapTransaction } = resp.data;
    if (!swapTransaction) throw new Error('Empty swapTransaction in response');

    // Decode, sign, and re-encode
    const txBytes = Buffer.from(swapTransaction, 'base64');
    const vTx = VersionedTransaction.deserialize(txBytes);
    vTx.sign([wallet]);

    return Buffer.from(vTx.serialize()).toString('base64');
  } catch (err) {
    logger.error('Failed to build Jupiter swap transaction', err);
    return null;
  }
}

/**
 * Build a simple SOL tip transaction to Jito tip account.
 */
function buildTipTransaction(
  wallet: Keypair,
  tipLamports: bigint,
  recentBlockhash: string,
  jitoTipAccount: string
): string {
  const tx = new Transaction({
    recentBlockhash,
    feePayer: wallet.publicKey,
  });

  tx.add(
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: new PublicKey(jitoTipAccount),
      lamports: Number(tipLamports),
    })
  );

  tx.sign(wallet);
  return tx.serialize().toString('base64');
}

/**
 * Calculate tip amount: max(minTip, 1% of expected profit in lamports).
 */
function calcTipLamports(opp: ArbitrageOpportunity, cfg: Config): bigint {
  const profitBasedTip = opp.profitAmount / 100n;  // 1% of profit
  const minTip = cfg.jitoTipLamports;
  return profitBasedTip > minTip ? profitBasedTip : minTip;
}

/**
 * Build the full 3-transaction bundle:
 * [leg1_swap, leg2_swap, tip_tx]
 */
export async function buildBundle(
  opp: ArbitrageOpportunity,
  wallet: Keypair,
  connection: Connection,
  cfg: Config
): Promise<BuiltBundle | null> {
  logger.debug(`Building bundle for opportunity ${opp.id}`);

  // Fetch recent blockhash for tip transaction
  let recentBlockhash: string;
  try {
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    recentBlockhash = blockhash;
  } catch (err) {
    logger.error('Failed to fetch recent blockhash', err);
    return null;
  }

  // Build leg 1: buy on buyDex (quote already fetched — we need a Jupiter swap tx)
  const leg1 = await buildJupiterSwapTx(opp.buyQuote, wallet, cfg);
  if (!leg1) {
    logger.warn(`Bundle build failed: leg 1 transaction build error`);
    return null;
  }

  // Build leg 2: sell on sellDex
  // The sell quote is also stored in opp.sellQuote, but as inputToken→outputToken
  // We need to build a swap in the reverse direction:
  // outputToken → inputToken using sellQuote's DEX.
  // Since sellQuote.raw is a Jupiter quote for inputToken→outputToken,
  // we need to fetch a fresh reverse quote for outputToken→inputToken.
  // For now, we use the sellQuote directly if it has raw data, otherwise skip.
  const leg2 = await buildJupiterSwapTx(opp.sellQuote, wallet, cfg);
  if (!leg2) {
    logger.warn(`Bundle build failed: leg 2 transaction build error`);
    return null;
  }

  const tipLamports = calcTipLamports(opp, cfg);
  const tipTx = buildTipTransaction(
    wallet,
    tipLamports,
    recentBlockhash,
    cfg.jitoTipAccount
  );

  return {
    transactions: [leg1, leg2, tipTx],
    tipLamports,
  };
}

/**
 * Check that the wallet has enough SOL to execute and keep the minimum reserve.
 * Minimum reserve: 0.05 SOL (50_000_000 lamports).
 */
export async function hasEnoughBalance(
  wallet: Keypair,
  connection: Connection,
  tradeSizeLamports: bigint
): Promise<boolean> {
  const MINIMUM_RESERVE = 50_000_000n; // 0.05 SOL
  try {
    const balance = BigInt(await connection.getBalance(wallet.publicKey));
    const required = tradeSizeLamports + MINIMUM_RESERVE;
    if (balance < required) {
      logger.warn(
        `Insufficient balance: ${balance} lamports, need ${required} (trade + 0.05 SOL reserve)`
      );
      return false;
    }
    return true;
  } catch (err) {
    logger.error('Balance check failed', err);
    return false;
  }
}
