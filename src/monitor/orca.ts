/**
 * Orca Whirlpool price checker.
 *
 * Uses the Orca public API to get pool list, finds matching pools,
 * and derives price from the pool's sqrtPrice or price field.
 * Falls back to Jupiter router restricted to Orca.
 */

import axios, { AxiosError } from 'axios';
import { DexQuote, Token } from '../types';
import { fetchJupiterQuoteViaDex } from './jupiter';
import { logger } from '../utils/logger';

const ORCA_POOL_API = 'https://api.mainnet.orca.so/v1/whirlpool/list';

interface OrcaPool {
  address: string;
  tokenA: { mint: string; decimals: number; symbol: string };
  tokenB: { mint: string; decimals: number; symbol: string };
  price: number;  // tokenB per tokenA
  tvl: number;
  lpFeeRate: number;
}

interface OrcaPoolListResponse {
  whirlpools: OrcaPool[];
}

let poolCache: OrcaPool[] = [];
let poolCacheAt = 0;
const POOL_CACHE_TTL = 60_000;

async function getOrcaPools(): Promise<OrcaPool[]> {
  const now = Date.now();
  if (poolCache.length > 0 && now - poolCacheAt < POOL_CACHE_TTL) {
    return poolCache;
  }

  try {
    const resp = await axios.get<OrcaPoolListResponse>(ORCA_POOL_API, {
      timeout: 10_000,
    });
    poolCache = resp.data?.whirlpools ?? [];
    poolCacheAt = now;
    return poolCache;
  } catch (err) {
    const axiosErr = err as AxiosError;
    if (axiosErr.response?.status === 429) {
      logger.warn('Orca API rate-limited, using stale pool cache');
    } else {
      logger.debug('Orca pool fetch failed', err);
    }
    return poolCache;
  }
}

function findOrcaPool(
  pools: OrcaPool[],
  mintA: string,
  mintB: string
): OrcaPool | undefined {
  // Sort by TVL descending to pick the most liquid pool first
  const matches = pools
    .filter(
      (p) =>
        (p.tokenA.mint === mintA && p.tokenB.mint === mintB) ||
        (p.tokenA.mint === mintB && p.tokenB.mint === mintA)
    )
    .sort((a, b) => (b.tvl ?? 0) - (a.tvl ?? 0));
  return matches[0];
}

export async function fetchOrcaQuote(
  inputToken: Token,
  outputToken: Token,
  inputAmountLamports: bigint,
  slippageBps: number
): Promise<DexQuote | null> {
  // Primary: Jupiter router restricted to Orca — gives real execution price with impact
  const raw = await fetchJupiterQuoteViaDex(
    inputToken,
    outputToken,
    inputAmountLamports,
    slippageBps,
    'Orca V2'
  );

  if (!raw) {
    // Second try: different Orca label in Jupiter
    const raw2 = await fetchJupiterQuoteViaDex(
      inputToken,
      outputToken,
      inputAmountLamports,
      slippageBps,
      'Whirlpool'
    );
    if (!raw2) {
      // Last resort: direct Orca pool spot price (may not reflect real price impact)
      try {
        const pools = await getOrcaPools();
        const pool = findOrcaPool(pools, inputToken.mint, outputToken.mint);
        if (pool) {
          const isForward = pool.tokenA.mint === inputToken.mint;
          const poolPrice = isForward ? pool.price : 1 / pool.price;
          const inputHuman = Number(inputAmountLamports) / Math.pow(10, inputToken.decimals);
          const outputHuman = inputHuman * poolPrice;
          const outputLamports = BigInt(Math.floor(outputHuman * Math.pow(10, outputToken.decimals)));
          return {
            dex: 'Orca',
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
        logger.debug('Orca fallback pool price also failed', err);
      }
      return null;
    }

    const inputAmt = BigInt(raw2.inAmount);
    const outputAmt = BigInt(raw2.outAmount);
    const inputHuman = Number(inputAmt) / Math.pow(10, inputToken.decimals);
    const outputHuman = Number(outputAmt) / Math.pow(10, outputToken.decimals);

    return {
      dex: 'Orca',
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
    dex: 'Orca',
    inputMint: inputToken.mint,
    outputMint: outputToken.mint,
    inputAmount: inputAmt,
    outputAmount: outputAmt,
    price: outputHuman / inputHuman,
    raw,
    fetchedAt: Date.now(),
  };
}
