/**
 * Token recovery helper.
 *
 * When leg 2 of an arb fails, we may be left holding an intermediate token
 * (e.g. USDC after buying with SOL). This module detects stranded SPL tokens
 * and swaps them back to SOL via Jupiter immediately.
 *
 * Called automatically after a failed execution — no manual intervention needed.
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';

// TOKEN_PROGRAM_ID without requiring @solana/spl-token
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
import axios from 'axios';
import { VersionedTransaction } from '@solana/web3.js';
import { Config } from '../config';
import { logger } from '../utils/logger';

const SOL_MINT = 'So11111111111111111111111111111111111111112';

// Minimum token value (in USD) to bother recovering — below this, gas > value
const MIN_RECOVERY_USD = 0.05;

// Known token decimals for quick conversion
const TOKEN_DECIMALS: Record<string, number> = {
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 6,  // USDC
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': 5,  // BONK
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN': 6,   // JUP
  'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm': 6,  // WIF
};

interface TokenAccount {
  mint: string;
  amount: bigint;
  decimals: number;
  address: string;
}

/**
 * Get all non-zero SPL token balances for the wallet.
 */
async function getTokenBalances(
  wallet: PublicKey,
  connection: Connection
): Promise<TokenAccount[]> {
  try {
    const accounts = await connection.getParsedTokenAccountsByOwner(wallet, {
      programId: TOKEN_PROGRAM_ID,
    });

    return accounts.value
      .map(a => ({
        mint: a.account.data.parsed.info.mint as string,
        amount: BigInt(a.account.data.parsed.info.tokenAmount.amount),
        decimals: a.account.data.parsed.info.tokenAmount.decimals as number,
        address: a.pubkey.toBase58(),
      }))
      .filter(t => t.amount > 0n);
  } catch (err) {
    logger.debug('Failed to get token balances', err);
    return [];
  }
}

/**
 * Swap a token back to SOL via Jupiter.
 */
async function swapToSol(
  mint: string,
  amount: bigint,
  wallet: Keypair,
  connection: Connection,
  cfg: Config
): Promise<boolean> {
  const jupHeaders = cfg.jupiterApiKey ? { 'x-api-key': cfg.jupiterApiKey } : {};
  const quoteUrl = cfg.jupiterApiKey
    ? 'https://api.jup.ag/swap/v1/quote'
    : 'https://lite-api.jup.ag/swap/v1/quote';

  try {
    // Get quote
    const qResp = await axios.get(quoteUrl, {
      params: {
        inputMint: mint,
        outputMint: SOL_MINT,
        amount: amount.toString(),
        slippageBps: 500,  // generous slippage for recovery
        onlyDirectRoutes: false,
      },
      timeout: 8_000,
      headers: jupHeaders,
    });

    if (!qResp.data?.outAmount) {
      logger.warn(`No recovery quote for mint ${mint}`);
      return false;
    }

    const outSol = Number(qResp.data.outAmount) / 1e9;
    logger.info(`Recovery quote: ${Number(amount)} → ${outSol.toFixed(6)} SOL`);

    // Build swap tx
    const sResp = await axios.post<{ swapTransaction: string }>(
      'https://api.jup.ag/swap/v1/swap',
      {
        quoteResponse: qResp.data,
        userPublicKey: wallet.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 'auto',
      },
      { timeout: 10_000, headers: { 'Content-Type': 'application/json', ...jupHeaders } }
    );

    const { swapTransaction } = sResp.data;
    if (!swapTransaction) return false;

    const txBytes = Buffer.from(swapTransaction, 'base64');
    const vTx = VersionedTransaction.deserialize(txBytes);
    vTx.sign([wallet]);

    const sig = await connection.sendRawTransaction(Buffer.from(vTx.serialize()), {
      skipPreflight: true,
      maxRetries: 3,
    });

    logger.info(`🔄 Recovery tx sent: ${sig}`);

    // Poll for confirmation
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const { value } = await connection.getSignatureStatuses([sig]);
      const status = value[0];
      if (status && !status.err &&
          (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized')) {
        logger.info(`✅ Recovery confirmed: ${sig} — swapped back to SOL`);
        return true;
      }
      if (status?.err) {
        logger.warn(`Recovery tx failed on-chain: ${JSON.stringify(status.err)}`);
        return false;
      }
      await new Promise(r => setTimeout(r, 400));
    }

    logger.warn(`Recovery tx timeout — check ${sig} manually`);
    return false;
  } catch (err) {
    logger.error('Recovery swap failed', err);
    return false;
  }
}

/**
 * Scan wallet for stranded tokens and swap them back to SOL.
 * Call this after a failed leg 2 execution.
 *
 * @param expectedMint - the intermediate token mint we may be holding
 * @param cfg - bot config
 */
export async function recoverStrandedTokens(
  expectedMint: string,
  wallet: Keypair,
  connection: Connection,
  cfg: Config
): Promise<void> {
  logger.info('🔍 Scanning for stranded tokens...');

  const balances = await getTokenBalances(wallet.publicKey, connection);
  const stranded = balances.filter(t => t.mint === expectedMint);

  if (stranded.length === 0) {
    logger.info('No stranded tokens found — wallet is clean');
    return;
  }

  for (const token of stranded) {
    const humanAmount = Number(token.amount) / Math.pow(10, token.decimals);
    logger.info(`Found stranded token: ${token.mint} — ${humanAmount.toFixed(6)} units`);

    // Skip dust amounts
    if (token.amount < 1000n) {
      logger.debug('Amount too small to recover (dust)');
      continue;
    }

    logger.info(`🔄 Auto-recovering ${humanAmount.toFixed(6)} of ${token.mint} → SOL`);
    await swapToSol(token.mint, token.amount, wallet, connection, cfg);
  }
}
