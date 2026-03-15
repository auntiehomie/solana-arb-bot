/**
 * Meteora DLMM price checker.
 *
 * Fetches all DLMM pairs from Meteora's public API, finds relevant pools,
 * and derives a price. Falls back to Jupiter router restricted to Meteora.
 */

import axios, { AxiosError } from 'axios';
import { DexQuote, Token } from '../types';
import { fetchJupiterQuoteViaDex } from './jupiter';
import { logger } from '../utils/logger';

const METEORA_PAIR_API = 'https://dlmm-api.meteora.ag/pair/all';

interface MeteoraPair {
  address: string;
  mint_x: string;    // token X mint
  mint_y: string;    // token Y mint
  current_price: number;  // price of X in terms of Y
  liquidity: number;
  trade_volume_24h: number;
  fees_24h: number;
}

let pairCache: MeteoraPair[] = [];
let pairCacheAt = 0;
const PAIR_CACHE_TTL = 15_000;

async function getMeteoraPairs(): Promise<MeteoraPair[]> {
  const now = Date.now();
  if (pairCache.length > 0 && now - pairCacheAt < PAIR_CACHE_TTL) {
    return pairCache;
  }

  try {
    const resp = await axios.get<MeteoraPair[]>(METEORA_PAIR_API, {
      timeout: 10_000,
    });
    pairCache = Array.isArray(resp.data) ? resp.data : [];
    pairCacheAt = now;
    return pairCache;
  } catch (err) {
    const axiosErr = err as AxiosError;
    if (axiosErr.response?.status === 429) {
      logger.warn('Meteora API rate-limited, using stale pair cache');
    } else {
      logger.debug('Meteora pair fetch failed', err);
    }
    return pairCache;
  }
}

function findMeteoraPair(
  pairs: MeteoraPair[],
  mintA: string,
  mintB: string
): MeteoraPair | undefined {
  const matches = pairs
    .filter(
      (p) =>
        (p.mint_x === mintA && p.mint_y === mintB) ||
        (p.mint_x === mintB && p.mint_y === mintA)
    )
    .sort((a, b) => (b.liquidity ?? 0) - (a.liquidity ?? 0));
  return matches[0];
}

export async function fetchMeteoraQuote(
  inputToken: Token,
  outputToken: Token,
  inputAmountLamports: bigint,
  slippageBps: number
): Promise<DexQuote | null> {
  // Primary: Jupiter router restricted to Meteora — real execution price with impact
  const raw = await fetchJupiterQuoteViaDex(
    inputToken,
    outputToken,
    inputAmountLamports,
    slippageBps,
    'Meteora DLMM'
  );

  if (!raw) {
    const raw2 = await fetchJupiterQuoteViaDex(
      inputToken,
      outputToken,
      inputAmountLamports,
      slippageBps,
      'Meteora'
    );
    if (!raw2) {
      // Last resort: direct Meteora pool spot price
      try {
        const pairs = await getMeteoraPairs();
        const pair = findMeteoraPair(pairs, inputToken.mint, outputToken.mint);
        if (pair) {
          const isForward = pair.mint_x === inputToken.mint;
          const poolPrice = isForward ? pair.current_price : 1 / pair.current_price;
          const inputHuman = Number(inputAmountLamports) / Math.pow(10, inputToken.decimals);
          const outputHuman = inputHuman * poolPrice;
          const outputLamports = BigInt(Math.floor(outputHuman * Math.pow(10, outputToken.decimals)));
          return {
            dex: 'Meteora',
            inputMint: inputToken.mint,
            outputMint: outputToken.mint,
            inputAmount: inputAmountLamports,
            outputAmount: outputLamports,
            price: poolPrice,
            raw: pair,
            fetchedAt: Date.now(),
          };
        }
      } catch (err) {
        logger.debug('Meteora fallback pool price also failed', err);
      }
      return null;
    }

    const inputAmt = BigInt(raw2.inAmount);
    const outputAmt = BigInt(raw2.outAmount);
    const inputHuman = Number(inputAmt) / Math.pow(10, inputToken.decimals);
    const outputHuman = Number(outputAmt) / Math.pow(10, outputToken.decimals);

    return {
      dex: 'Meteora',
      inputMint: inputToken.mint,
      outputMint: outputToken.mint,
      inputAmount: inputAmt,
      outputAmount: outputAmt,
      price: outputHuman / inputHuman,
      raw: raw2,
      fetchedAt: Date.now(),
    };
  }

  const inputAmt = BigInt(raw.inAmount);
  const outputAmt = BigInt(raw.outAmount);
  const inputHuman = Number(inputAmt) / Math.pow(10, inputToken.decimals);
  const outputHuman = Number(outputAmt) / Math.pow(10, outputToken.decimals);

  return {
    dex: 'Meteora',
    inputMint: inputToken.mint,
    outputMint: outputToken.mint,
    inputAmount: inputAmt,
    outputAmount: outputAmt,
    price: outputHuman / inputHuman,
    raw,
    fetchedAt: Date.now(),
  };
}
