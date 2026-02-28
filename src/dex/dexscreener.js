import axios from 'axios';
import { config, getTokenMint } from '../config.js';

export class DexScreenerFetcher {
  constructor() {
    this.apiBase = 'https://api.dexscreener.com/latest/dex';
    this.cache = new Map();
    this.cacheTTL = 30000; // 30 seconds
  }

  async getPrice(tokenSymbol) {
    try {
      const mint = getTokenMint(tokenSymbol);
      if (!mint) {
        throw new Error(`Unknown token: ${tokenSymbol}`);
      }

      // Check cache
      const cacheKey = mint;
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
        return cached.data;
      }

      const response = await axios.get(`${this.apiBase}/tokens/${mint}`, {
        timeout: 10000
      });

      if (response.data?.pairs && response.data.pairs.length > 0) {
        // Filter for SOL pairs on major Solana DEXes
        const WSOL_MINT = 'So11111111111111111111111111111111111111112';
        const solanaUsdcPairs = response.data.pairs.filter(pair =>
          pair.chainId === 'solana' &&
          (pair.quoteToken.address === WSOL_MINT ||
           pair.quoteToken.symbol === 'SOL'  ||
           pair.quoteToken.symbol === 'WSOL')
        );

        if (solanaUsdcPairs.length === 0) {
          console.log(`No SOL pairs found for ${tokenSymbol}`);
          return null;
        }

        // Keep every pool as its own price point so the detector can
        // compare the cheapest pool on DEX A vs the most expensive on DEX B.
        const dexPrices = {};
        solanaUsdcPairs.forEach(pair => {
          const dexName = this.normalizeDexName(pair.dexId);
          const price = parseFloat(pair.priceUsd);
          const key = pair.pairAddress; // unique per pool
          
          dexPrices[key] = {
            exchange: dexName,
            price: price,
            timestamp: Date.now(),
            liquidity: parseFloat(pair.liquidity?.usd || 0),
            volume24h: parseFloat(pair.volume?.h24 || 0),
            pairAddress: pair.pairAddress
          };
        });

        // Cache the result
        this.cache.set(cacheKey, {
          timestamp: Date.now(),
          data: dexPrices
        });

        return dexPrices;
      }

      return null;
    } catch (error) {
      console.error(`DexScreener price fetch error for ${tokenSymbol}:`, error.message);
      return null;
    }
  }

  async getPrices(tokenSymbols) {
    const results = {};
    
    for (const symbol of tokenSymbols) {
      const prices = await this.getPrice(symbol);
      if (prices) {
        results[symbol] = prices;
      }
    }
    
    return results;
  }

  normalizeDexName(dexId) {
    // Map DexScreener dex IDs to readable names
    const mapping = {
      'raydium': 'Raydium',
      'orca': 'Orca',
      'jupiter': 'Jupiter',
      'phoenix': 'Phoenix',
      'meteora': 'Meteora',
      'lifinity': 'Lifinity',
      'valiant': 'Valiant',
      'saber': 'Saber'
    };
    
    return mapping[dexId.toLowerCase()] || dexId;
  }
}
