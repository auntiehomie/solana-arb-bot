/**
 * Raydium price checker.
 *
 * Strategy: fetch Raydium CLMM pool list, find pools matching our token pairs,
 * compute an effective swap price from pool state (sqrtPriceX64).
 *
 * As a simpler fallback we also use the Jupiter router restricted to Raydium.
 */

import axios, { AxiosError } from 'axios';
import { DexQuote, Token, TOKENS } from '../types';
import { fetchJupiterQuoteViaDex } from './jupiter';
import { logger } from '../utils/logger';

const RAYDIUM_POOL_API = 'https://api.raydium.io/v2/ammV3/ammPools';

interface RaydiumPool {
  id: string;
  mintA: { address: string; decimals: number };
  mintB: { address: string; decimals: number };
  price: number;   // current pool price (mintB per mintA)
  tvl: number;
}

interface RaydiumPoolsResponse {
  data: RaydiumPool[];
}

// Cache pools for 60 s to reduce API load
let poolCache: RaydiumPool[] = [];
let poolCacheAt = 0;
const POOL_CACHE_TTL = 60_000;

async function getRaydiumPools(): Promise<RaydiumPool[]> {
  const now = Date.now();
  if (poolCache.length > 0 && now - poolCacheAt < POOL_CACHE_TTL) {
    return poolCache;
  }

  try {
    const resp = await axios.get<RaydiumPoolsResponse>(RAYDIUM_POOL_API, {
      timeout: 10_000,
    });
    poolCache = resp.data?.data ?? [];
    poolCacheAt = now;
    return poolCache;
  } catch (err) {
    const axiosErr = err as AxiosError;
    if (axiosErr.response?.status === 429) {
      logger.warn('Raydium API rate-limited, using stale cache');
    } else {
      logger.debug('Raydium pool fetch failed', err);
    }
    return poolCache; // stale
  }
}

function findPool(
  pools: RaydiumPool[],
  mintA: string,
  mintB: string
): RaydiumPool | undefined {
  return pools.find(
    (p) =>
      (p.mintA.address === mintA && p.mintB.address === mintB) ||
      (p.mintA.address === mintB && p.mintB.address === mintA)
  );
}

/**
 * Get Raydium price for inputToken → outputToken.
 * Returns null on failure.
 */
export async function fetchRaydiumQuote(
  inputToken: Token,
  outputToken: Token,
  inputAmountLamports: bigint,
  slippageBps: number
): Promise<DexQuote | null> {
  // First try: direct pool price from Raydium API
  try {
    const pools = await getRaydiumPools();
    const pool = findPool(pools, inputToken.mint, outputToken.mint);

    if (pool) {
      // Determine direction
      const isForward = pool.mintA.address === inputToken.mint;
      const poolPrice = isForward ? pool.price : 1 / pool.price;

      const inputHuman = Number(inputAmountLamports) / Math.pow(10, inputToken.decimals);
      const outputHuman = inputHuman * poolPrice;
      const outputLamports = BigInt(
        Math.floor(outputHuman * Math.pow(10, outputToken.decimals))
      );

      return {
        dex: 'Raydium',
        inputMint: inputToken.mint,
        outputMint: outputToken.mint,
        inputAmount: inputAmountLamports,
        outputAmount: outputLamports,
        price: poolPrice,
        raw: pool,
        fetchedAt: Date.now(),
      };
    }
  } catch (err) {
    logger.debug('Raydium direct price failed, falling back to Jupiter router', err);
  }

  // Fallback: use Jupiter router restricted to Raydium CLMM / AMM
  const raw = await fetchJupiterQuoteViaDex(
    inputToken,
    outputToken,
    inputAmountLamports,
    slippageBps,
    'Raydium CLMM'
  );

  if (!raw) {
    // Try Raydium (legacy AMM)
    const raw2 = await fetchJupiterQuoteViaDex(
      inputToken,
      outputToken,
      inputAmountLamports,
      slippageBps,
      'Raydium'
    );
    if (!raw2) return null;

    const inputAmt = BigInt(raw2.inAmount);
    const outputAmt = BigInt(raw2.outAmount);
    const inputHuman = Number(inputAmt) / Math.pow(10, inputToken.decimals);
    const outputHuman = Number(outputAmt) / Math.pow(10, outputToken.decimals);

    return {
      dex: 'Raydium',
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
    dex: 'Raydium',
    inputMint: inputToken.mint,
    outputMint: outputToken.mint,
    inputAmount: inputAmt,
    outputAmount: outputAmt,
    price: outputHuman / inputHuman,
    raw,
    fetchedAt: Date.now(),
  };
}
