/**
 * Jupiter v6 quote fetcher.
 *
 * We use Jupiter both as a DEX source (its own aggregated best route)
 * and to get per-DEX quotes via the `dexes` filter param.
 */

import axios, { AxiosError } from 'axios';
import { DexQuote, Token } from '../types';
import { logger } from '../utils/logger';

const QUOTE_URL = 'https://quote-api.jup.ag/v6/quote';

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

async function fetchWithBackoff<T>(
  url: string,
  params: Record<string, string | number | boolean>,
  retries = 3
): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await axios.get<T>(url, { params, timeout: 8000 });
      return resp.data;
    } catch (err) {
      const axiosErr = err as AxiosError;
      const status = axiosErr.response?.status;
      if (status === 429 && attempt < retries) {
        const delay = Math.pow(2, attempt) * 500;
        logger.warn(`Jupiter rate-limited, retrying in ${delay}ms (attempt ${attempt + 1})`);
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }
  throw new Error('Exhausted retries');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Fetch a Jupiter quote (best route, which may itself be multi-DEX).
 * Returns null if no route found or on error.
 */
export async function fetchJupiterQuote(
  inputToken: Token,
  outputToken: Token,
  inputAmountLamports: bigint,
  slippageBps: number
): Promise<DexQuote | null> {
  try {
    const data = await fetchWithBackoff<JupiterQuoteResponse>(QUOTE_URL, {
      inputMint: inputToken.mint,
      outputMint: outputToken.mint,
      amount: inputAmountLamports.toString(),
      slippageBps,
      onlyDirectRoutes: false,
    });

    if (!data?.outAmount) return null;

    const inputAmt = BigInt(data.inAmount);
    const outputAmt = BigInt(data.outAmount);

    // Price in output-token per input-token (human units)
    const inputHuman = Number(inputAmt) / Math.pow(10, inputToken.decimals);
    const outputHuman = Number(outputAmt) / Math.pow(10, outputToken.decimals);
    const price = outputHuman / inputHuman;

    return {
      dex: 'Jupiter',
      inputMint: inputToken.mint,
      outputMint: outputToken.mint,
      inputAmount: inputAmt,
      outputAmount: outputAmt,
      price,
      raw: data,
      fetchedAt: Date.now(),
    };
  } catch (err) {
    logger.debug(`Jupiter quote failed [${inputToken.symbol}→${outputToken.symbol}]`, err);
    return null;
  }
}

/**
 * Fetch Jupiter quotes specifically routing through a target DEX label.
 * Useful to isolate Raydium/Orca/Meteora pricing via the Jupiter router.
 */
export async function fetchJupiterQuoteViaDex(
  inputToken: Token,
  outputToken: Token,
  inputAmountLamports: bigint,
  slippageBps: number,
  dexLabel: string
): Promise<JupiterQuoteResponse | null> {
  try {
    const data = await fetchWithBackoff<JupiterQuoteResponse>(QUOTE_URL, {
      inputMint: inputToken.mint,
      outputMint: outputToken.mint,
      amount: inputAmountLamports.toString(),
      slippageBps,
      onlyDirectRoutes: true,
      dexes: dexLabel,
    });
    return data ?? null;
  } catch (err) {
    logger.debug(`Jupiter quote via ${dexLabel} failed`, err);
    return null;
  }
}
