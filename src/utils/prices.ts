/**
 * USD price helpers.
 * Primary source: Jupiter price API (free, no key required)
 * Fallback: CoinGecko public API
 */

import axios from 'axios';
import { logger } from './logger';
import { UsdPrices } from '../types';

const COINGECKO_IDS: Record<string, string> = {
  SOL:   'solana',
  JUP:   'jupiter-exchange-solana',
  PENGU: 'pudgy-penguins',
  BONK:  'bonk',
};

// Jupiter Price API — try lite-api first (different host), then price.jup.ag
const JUPITER_PRICE_URLS = [
  'https://lite-api.jup.ag/price/v2',
  'https://api.jup.ag/price/v2',
  'https://price.jup.ag/v6/price',
];

const MINT_BY_SYMBOL: Record<string, string> = {
  SOL:   'So11111111111111111111111111111111111111112',
  JUP:   'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
  PENGU: '2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv',
  BONK:  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
};

let cachedPrices: UsdPrices = {};
let lastFetchedAt = 0;
const CACHE_TTL_MS = 60_000;  // 60s — reduces CoinGecko hammering

export async function getUsdPrices(symbols: string[]): Promise<UsdPrices> {
  const now = Date.now();
  if (now - lastFetchedAt < CACHE_TTL_MS && Object.keys(cachedPrices).length > 0) {
    return cachedPrices;
  }

  try {
    cachedPrices = await fetchJupiterPrices(symbols);
    lastFetchedAt = now;
    return cachedPrices;
  } catch (err) {
    logger.warn('Jupiter price fetch failed, trying CoinGecko fallback', err);
  }

  try {
    cachedPrices = await fetchCoinGeckoPrices(symbols);
    lastFetchedAt = now;
    return cachedPrices;
  } catch (err) {
    logger.error('CoinGecko price fetch also failed', err);
    // Return stale cache or empty
    return cachedPrices;
  }
}

async function fetchJupiterPrices(symbols: string[]): Promise<UsdPrices> {
  const ids = symbols.map((s) => MINT_BY_SYMBOL[s]).filter(Boolean).join(',');
  let lastErr: unknown;

  for (const url of JUPITER_PRICE_URLS) {
    try {
      const resp = await axios.get<{
        data: Record<string, { id: string; price: string }>;
      }>(url, {
        params: { ids },
        timeout: 5000,
      });

      const prices: UsdPrices = {};
      const data = resp.data?.data ?? {};

      for (const symbol of symbols) {
        const mint = MINT_BY_SYMBOL[symbol];
        if (mint && data[mint]) {
          prices[symbol] = parseFloat(data[mint].price);
        }
      }

      if (Object.keys(prices).length > 0) return prices;
    } catch (err) {
      lastErr = err;
      logger.debug(`Jupiter price fetch failed at ${url}, trying next`, err);
    }
  }

  throw lastErr ?? new Error('All Jupiter price endpoints failed');
}

async function fetchCoinGeckoPrices(symbols: string[]): Promise<UsdPrices> {
  const ids = symbols
    .map((s) => COINGECKO_IDS[s])
    .filter(Boolean)
    .join(',');

  const resp = await axios.get<Record<string, { usd: number }>>(
    'https://api.coingecko.com/api/v3/simple/price',
    {
      params: { ids, vs_currencies: 'usd' },
      timeout: 8000,
    }
  );

  const prices: UsdPrices = {};
  for (const symbol of symbols) {
    const cgId = COINGECKO_IDS[symbol];
    if (cgId && resp.data[cgId]?.usd) {
      prices[symbol] = resp.data[cgId].usd;
    }
  }
  return prices;
}

/** Convert a token amount (in smallest units) to USD */
export function toUsd(
  amountSmallest: bigint,
  decimals: number,
  usdPrice: number
): number {
  const humanAmount = Number(amountSmallest) / Math.pow(10, decimals);
  return humanAmount * usdPrice;
}
