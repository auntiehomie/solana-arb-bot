import axios from 'axios';
import { config, getTokenMint } from '../config.js';

export class RaydiumPriceFetcher {
  constructor() {
    this.apiBase = config.raydiumApi;
    this.poolCache = new Map();
    this.cacheExpiry = 5 * 60 * 1000; // 5 minutes
  }

  async getPrice(tokenSymbol) {
    try {
      const mint = getTokenMint(tokenSymbol);
      if (!mint) {
        throw new Error(`Unknown token: ${tokenSymbol}`);
      }

      // Try to fetch pool info
      const response = await axios.get(`${this.apiBase}/pools/info/mint`, {
        params: {
          mint1: mint,
          mint2: getTokenMint('USDC'),
          poolType: 'all',
          poolSortField: 'liquidity',
          sortType: 'desc',
          pageSize: 1
        },
        timeout: 5000
      });

      if (response.data?.data?.data?.[0]) {
        const pool = response.data.data.data[0];
        // Calculate price from pool reserves
        const price = this.calculatePrice(pool, mint);
        
        return {
          exchange: 'Raydium',
          price,
          timestamp: Date.now()
        };
      }

      return null;
    } catch (error) {
      // Raydium API can be flaky, don't spam errors
      if (error.response?.status !== 404) {
        console.error(`Raydium price fetch error for ${tokenSymbol}:`, error.message);
      }
      return null;
    }
  }

  calculatePrice(pool, tokenMint) {
    // Simplified price calculation from pool data
    // In real implementation, need to handle decimals properly
    try {
      const isMint0 = pool.mintA.address === tokenMint;
      const tokenReserve = isMint0 ? pool.mintAmountA : pool.mintAmountB;
      const usdcReserve = isMint0 ? pool.mintAmountB : pool.mintAmountA;
      
      if (tokenReserve && usdcReserve) {
        return parseFloat(usdcReserve) / parseFloat(tokenReserve);
      }
    } catch (error) {
      console.error('Price calculation error:', error.message);
    }
    
    return null;
  }

  async getPrices(tokenSymbols) {
    const prices = {};
    
    // Fetch prices sequentially to avoid rate limits
    for (const symbol of tokenSymbols) {
      const priceData = await this.getPrice(symbol);
      if (priceData) {
        prices[symbol] = priceData;
      }
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    return prices;
  }
}
