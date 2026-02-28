import axios from 'axios';
import { config, getTokenMint } from '../config.js';

export class JupiterPriceFetcher {
  constructor() {
    this.apiBase = config.jupiterApi;
  }

  async getPrice(tokenSymbol) {
    try {
      const mint = getTokenMint(tokenSymbol);
      if (!mint) {
        throw new Error(`Unknown token: ${tokenSymbol}`);
      }

      const response = await axios.get(`${this.apiBase}/price`, {
        params: {
          ids: mint,
          vsToken: getTokenMint('USDC')
        },
        timeout: 5000
      });

      if (response.data?.data?.[mint]) {
        return {
          exchange: 'Jupiter',
          price: response.data.data[mint].price,
          timestamp: Date.now()
        };
      }

      return null;
    } catch (error) {
      console.error(`Jupiter price fetch error for ${tokenSymbol}:`, error.message);
      return null;
    }
  }

  async getPrices(tokenSymbols) {
    const mints = tokenSymbols.map(s => getTokenMint(s)).filter(Boolean);
    if (mints.length === 0) return {};

    try {
      const response = await axios.get(`${this.apiBase}/price`, {
        params: {
          ids: mints.join(','),
          vsToken: getTokenMint('USDC')
        },
        timeout: 5000
      });

      const prices = {};
      if (response.data?.data) {
        Object.entries(response.data.data).forEach(([mint, data]) => {
          const symbol = Object.entries(config.tokens).find(([_, m]) => m === mint)?.[0];
          if (symbol) {
            prices[symbol] = {
              exchange: 'Jupiter',
              price: data.price,
              timestamp: Date.now()
            };
          }
        });
      }

      return prices;
    } catch (error) {
      console.error('Jupiter batch price fetch error:', error.message);
      return {};
    }
  }
}
