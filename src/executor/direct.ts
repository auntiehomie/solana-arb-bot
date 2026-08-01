/**
 * Direct RPC executor for round-trip arbitrage opportunities.
 *
 * Executes two Jupiter swaps (buy leg + sell leg) using fresh quotes
 * fetched immediately before execution. Both transactions are signed
 * and sent simultaneously to minimise price drift between legs.
 */

import {
  Connection,
  Keypair,
  VersionedTransaction,
} from '@solana/web3.js';
import axios from 'axios';
import { CircularOpportunity } from '../scanner/circular';
import { Config } from '../config';
import { logger } from '../utils/logger';
import { logTradeAttemptStart, logTradeResult } from '../utils/jsonl-logger';
import { simulateTradePair } from './simulation';

const SWAP_URL = 'https://api.jup.ag/swap/v1/swap';
const QUOTE_URL_PRO = 'https://api.jup.ag/swap/v1/quote';
const QUOTE_URL_LITE = 'https://lite-api.jup.ag/swap/v1/quote';

function getQuoteUrl(cfg: Config): string {
  return cfg.jupiterApiKey ? QUOTE_URL_PRO : QUOTE_URL_LITE;
}

/**
 * Fetch a fresh Jupiter quote and build a signed VersionedTransaction.
 * Returns base64-encoded signed tx or null on failure.
 */
async function buildFreshSwapTx(
  inputMint: string,
  outputMint: string,
  amount: bigint,
  wallet: Keypair,
  cfg: Config,
  label: string
): Promise<string | null> {
  const jupHeaders = cfg.jupiterApiKey ? { 'x-api-key': cfg.jupiterApiKey } : {};

  // Fresh quote
  let rawQuote: unknown;
  try {
    const r = await axios.get(getQuoteUrl(cfg), {
      params: {
        inputMint,
        outputMint,
        amount: amount.toString(),
        slippageBps: cfg.maxSlippageBps,
        onlyDirectRoutes: false,
      },
      timeout: 8_000,
      headers: jupHeaders,
    });
    if (!r.data?.outAmount) {
      logger.debug(`No quote for ${label}`);
      return null;
    }
    rawQuote = r.data;
  } catch (err) {
    logger.debug(`Quote fetch failed [${label}]`, (err as Error).message);
    return null;
  }

  // Build swap tx
  try {
    const resp = await axios.post<{ swapTransaction: string }>(
      SWAP_URL,
      {
        quoteResponse: rawQuote,
        userPublicKey: wallet.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 'auto',
      },
      {
        timeout: 10_000,
        headers: { 'Content-Type': 'application/json', ...jupHeaders },
      }
    );

    const { swapTransaction } = resp.data;
    if (!swapTransaction) return null;

    const txBytes = Buffer.from(swapTransaction, 'base64');
    const vTx = VersionedTransaction.deserialize(txBytes);
    vTx.sign([wallet]);
    return Buffer.from(vTx.serialize()).toString('base64');
  } catch (err) {
    const msg = axios.isAxiosError(err)
      ? `${err.response?.status}: ${JSON.stringify(err.response?.data)}`
      : (err as Error).message;
    logger.debug(`Swap build failed [${label}]: ${msg}`);
    return null;
  }
}

/**
 * Send a signed tx and wait for confirmation.
 */
async function sendAndConfirm(
  txBase64: string,
  connection: Connection,
  label: string
): Promise<{ success: boolean; signature?: string; error?: string }> {
  let sig: string;
  try {
    sig = await connection.sendRawTransaction(
      Buffer.from(txBase64, 'base64'),
      { skipPreflight: true, maxRetries: 3 }
    );
    logger.info(`${label} sent: ${sig}`);
  } catch (err) {
    return { success: false, error: `Send failed: ${(err as Error).message}` };
  }

  try {
    const { value } = await connection.confirmTransaction(sig, 'confirmed');
    if (value.err) {
      const errStr = JSON.stringify(value.err);
      const isSlippage = errStr.includes('6025') || errStr.includes('6024') || errStr.includes('6001') || errStr.includes('6000');
      return {
        success: false,
        signature: sig,
        error: isSlippage ? `Slippage: ${errStr}` : errStr,
      };
    }
    logger.info(`✅ ${label} confirmed: ${sig}`);
    return { success: true, signature: sig };
  } catch (err) {
    logger.warn(`Confirmation timeout for ${label} ${sig}`);
    return { success: false, signature: sig, error: `Confirm timeout: ${(err as Error).message}` };
  }
}

/**
 * Execute a circular (round-trip) arb: buy leg then sell leg.
 * Both txs are built with fresh quotes in parallel, then fired simultaneously.
 */
export async function executeCircular(
  opp: CircularOpportunity,
  wallet: Keypair,
  connection: Connection,
  cfg: Config
): Promise<{ success: boolean; signature?: string; leg1Sig?: string; leg2Sig?: string; error?: string }> {
  logger.info(
    `🚀 Executing: ${opp.token.symbol}→?→${opp.token.symbol} | ` +
    `Route: ${opp.route} | ` +
    `Expected: ${opp.profitPct.toFixed(3)}% / $${opp.profitUsd.toFixed(4)}`
  );

  // Log trade attempt to JSONL
  logTradeAttemptStart(
    opp.token.symbol,
    opp.inputAmount,
    opp.outputAmount,
    opp.profitAmount,
    opp.profitPct,
    opp.profitUsd,
    0, // netProfitSOL — will be updated at result
    opp.netProfitUsd,
    opp.profitUsd - opp.netProfitUsd, // feeSOL = grossProfitUSD - netProfitUSD
    opp.profitUsd - opp.netProfitUsd, // feeUSD
    cfg.dryRun,
    opp.route,
  );

  // Determine the intermediate token from the stored buy quote
  const buyQuoteData = opp.buyQuoteRaw as { outputMint?: string; outAmount?: string };
  const intermediateMint = buyQuoteData?.outputMint;
  if (!intermediateMint) {
    return { success: false, error: 'Cannot determine intermediate token mint from buy quote' };
  }

  // Build both legs in parallel with fresh quotes
  const [leg1Tx, leg2Tx] = await Promise.all([
    buildFreshSwapTx(
      opp.token.mint,
      intermediateMint,
      opp.inputAmount,
      wallet,
      cfg,
      'Leg1(buy)'
    ),
    buildFreshSwapTx(
      intermediateMint,
      opp.token.mint,
      opp.sellInputAmount,
      wallet,
      cfg,
      'Leg2(sell)'
    ),
  ]);

  if (!leg1Tx) return { success: false, error: 'Failed to build leg 1 (buy) transaction' };
  if (!leg2Tx) return { success: false, error: 'Failed to build leg 2 (sell) transaction' };

  // Pre-flight simulation — skip trade if either leg would fail
  if (cfg.simulateBeforeExecute) {
    logger.info('Running pre-flight simulation...');
    const { safe, leg1: simLeg1, leg2: simLeg2 } = await simulateTradePair(leg1Tx, leg2Tx, connection);
    if (!safe) {
      const failLeg = !simLeg1.success ? 'Leg1(buy)' : 'Leg2(sell)';
      const failReason = !simLeg1.success ? simLeg1.error : simLeg2.error;
      return { success: false, error: `Pre-flight simulation failed: ${failLeg} — ${failReason}` };
    }
  }

  // Fire both simultaneously
  logger.info('Firing both legs simultaneously...');
  const [leg1Sig, leg2Sig] = await Promise.all([
    (async () => {
      try {
        return await connection.sendRawTransaction(Buffer.from(leg1Tx, 'base64'), {
          skipPreflight: true, maxRetries: 3,
        });
      } catch { return null; }
    })(),
    (async () => {
      try {
        return await connection.sendRawTransaction(Buffer.from(leg2Tx, 'base64'), {
          skipPreflight: true, maxRetries: 3,
        });
      } catch { return null; }
    })(),
  ]);

  if (leg1Sig) logger.info(`Leg 1 sent: ${leg1Sig}`);
  if (leg2Sig) logger.info(`Leg 2 sent: ${leg2Sig}`);

  if (!leg1Sig && !leg2Sig) {
    return { success: false, error: 'Both legs failed to send' };
  }

  // Confirm both in parallel
  const [conf1, conf2] = await Promise.all([
    leg1Sig ? sendConfirmOnly(leg1Sig, connection, 'Leg1') : Promise.resolve({ success: false, error: 'not sent' }),
    leg2Sig ? sendConfirmOnly(leg2Sig, connection, 'Leg2') : Promise.resolve({ success: false, error: 'not sent' }),
  ]);

  const bothOk = conf1.success && conf2.success;
  if (bothOk) {
    logger.info(`💸 Arb complete! leg1=${leg1Sig} leg2=${leg2Sig}`);
  } else {
    logger.warn(`Leg results — leg1: ${conf1.success ? '✅' : '❌ ' + conf1.error} | leg2: ${conf2.success ? '✅' : '❌ ' + conf2.error}`);
  }

  // Log result to JSONL — fee in SOL estimated from feeUSD / SOL price
  const solPrice = opp.profitUsd > 0 && opp.profitAmount > 0n
    ? opp.profitUsd / (Number(opp.profitAmount) / 1e9) : 0;
  const feeUSD = opp.profitUsd - opp.netProfitUsd;
  const feeSOL = solPrice > 0 ? feeUSD / solPrice : 0;
  logTradeResult(
    opp.token.symbol,
    opp.inputAmount,
    opp.outputAmount,
    opp.profitAmount,
    opp.profitPct,
    opp.profitUsd,
    opp.netProfitPct > 0 ? (opp.netProfitPct / 100) * (Number(opp.inputAmount) / 1e9) : 0,
    opp.netProfitUsd,
    feeSOL,
    feeUSD,
    bothOk,
    cfg.dryRun,
    opp.route,
    leg1Sig ?? undefined,
    leg2Sig ?? undefined,
    bothOk ? undefined : `leg1=${conf1.error ?? 'ok'} leg2=${conf2.error ?? 'ok'}`,
  );

  return {
    success: bothOk,
    leg1Sig: leg1Sig ?? undefined,
    leg2Sig: leg2Sig ?? undefined,
    error: bothOk ? undefined : `leg1=${conf1.error ?? 'ok'} leg2=${conf2.error ?? 'ok'}`,
  };
}

/**
 * Poll for transaction confirmation via getSignatureStatuses — no WS subscription needed.
 * Avoids hitting Helius's 10-subscription cap with signatureSubscribe calls.
 */
async function sendConfirmOnly(
  sig: string,
  connection: Connection,
  label: string
): Promise<{ success: boolean; error?: string }> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const { value } = await connection.getSignatureStatuses([sig], { searchTransactionHistory: false });
      const status = value[0];
      if (status) {
        if (status.err) {
          const errStr = JSON.stringify(status.err);
          const isSlippage = errStr.includes('6025') || errStr.includes('6024') || errStr.includes('6001') || errStr.includes('6000');
          if (isSlippage) logger.warn(`Slippage on ${label} ${sig}`);
          return { success: false, error: isSlippage ? `Slippage: ${errStr}` : errStr };
        }
        if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
          logger.info(`✅ ${label} confirmed: ${sig}`);
          return { success: true };
        }
      }
    } catch { /* ignore poll errors, retry */ }
    await new Promise(r => setTimeout(r, 400));
  }
  return { success: false, error: `Confirm timeout after 30s` };
}
