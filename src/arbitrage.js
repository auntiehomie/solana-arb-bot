import { config } from './config.js';
import { DexScreenerFetcher } from './dex/dexscreener.js';
import { JupiterDexQuotes } from './dex/jupiter-dex-quotes.js';
import axios from 'axios';

export class ArbitrageDetector {
  constructor() {
    this.dexScreener  = new DexScreenerFetcher();
    this.jupiterQuotes = new JupiterDexQuotes();
  }

  async fetchAllPrices(tokenSymbol) {
    // ── Primary: Jupiter Quote API (real-time, on-chain prices) ──────────────
    try {
      const jupPrices = await this.jupiterQuotes.getPrices(tokenSymbol);
      if (jupPrices.length >= 2) {
        return jupPrices; // got at least 2 DEX quotes — enough to compare
      }
    } catch (_err) {
      // fall through to DexScreener backup
    }

    // ── Fallback: DexScreener (stale but broad coverage) ────────────────────
    const prices = [];
    const dexPrices = await this.dexScreener.getPrice(tokenSymbol);
    if (dexPrices) {
      Object.values(dexPrices).forEach(priceData => {
        if (priceData.liquidity > 10000 && priceData.volume24h > 500) {
          prices.push(priceData);
        }
      });
    }
    return prices;
  }

  findArbitrageOpportunities(prices, tokenSymbol = '') {
    const opportunities = [];
    const minThreshold = config.minProfitPercent * 100;
    let bestSpread = 0;
    let bestPair   = '';

    // Compare all pairs of exchanges
    for (let i = 0; i < prices.length; i++) {
      for (let j = i + 1; j < prices.length; j++) {
        const price1 = prices[i];
        const price2 = prices[j];

        // Skip if prices are too old (> 10 seconds)
        const now = Date.now();
        if (now - price1.timestamp > 10000 || now - price2.timestamp > 10000) {
          continue;
        }

        // Skip same-DEX pairs — two pools on the same DEX look like arb
        // but Jupiter will just route through the best pool, collapsing the spread
        if (price1.exchange === price2.exchange) continue;

        // Calculate potential profit
        const buyPrice = Math.min(price1.price, price2.price);
        const sellPrice = Math.max(price1.price, price2.price);
        const buyExchange = price1.price < price2.price ? price1.exchange : price2.exchange;
        const sellExchange = price1.price < price2.price ? price2.exchange : price1.exchange;

        // Raw spread before slippage (for logging)
        const rawSpread = ((sellPrice - buyPrice) / buyPrice) * 100;
        if (rawSpread > bestSpread) {
          bestSpread = rawSpread;
          bestPair   = `${buyExchange}→${sellExchange}`;
        }

        // Account for slippage
        const buyPriceWithSlippage = buyPrice * (1 + config.discoverySlippage || config.slippageTolerance);
        const sellPriceWithSlippage = sellPrice * (1 - config.discoverySlippage || config.slippageTolerance);

        const profitPercent = ((sellPriceWithSlippage - buyPriceWithSlippage) / buyPriceWithSlippage) * 100;
        
        // Check if opportunity meets minimum thresholds
        if (profitPercent >= minThreshold) {
          opportunities.push({
            buyExchange,
            sellExchange,
            buyPrice: buyPriceWithSlippage,
            sellPrice: sellPriceWithSlippage,
            profitPercent,
            timestamp: now
          });
        }
      }
    }

    // Always log best spread seen so we can tune the threshold
    if (bestPair) {
      const tag = bestSpread >= minThreshold ? '✅' : (bestSpread > 0.1 ? '🟡' : '🔴');
      console.log(`   ${tokenSymbol} best spread: ${bestSpread.toFixed(4)}% (${bestPair}) ${tag} need ${minThreshold.toFixed(2)}%`);

      // If spread is a near-miss (within 0.2% of the threshold), send a Discord alert
      const margin = 0.2; // percent
      if (bestSpread < minThreshold && bestSpread >= (minThreshold - margin)) {
        const webhook = config.discordWebhook || config.discordWebhookUrl;
        if (webhook) {
          const tradeSize = config.maxTradeAmountUsd || config.startingCapital || 0;
          const estimatedUsd = tradeSize * (bestSpread / 100);
          const payload = {
            content: `Near-miss: ${tokenSymbol} best spread ${bestSpread.toFixed(4)}% (${bestPair}) — threshold ${minThreshold.toFixed(2)}%\nBuy price ≈ ${buyPrice.toFixed(8)} ${config.baseToken}, Sell price ≈ ${sellPrice.toFixed(8)} ${config.baseToken}\nEstimated USD profit (on $${(config.startingCapital||0).toFixed(2)}): $${estimatedUsd.toFixed(4)}`
          };
          axios.post(webhook, payload).catch(err => {
            console.warn('Failed to send Discord webhook:', err.message);
          });
        }
      }
    }

    return opportunities;
  }

  async scanForOpportunities() {
    const allOpportunities = [];

    // Extract base tokens from pairs (e.g., "SOL/USDC" -> "SOL")
    const baseTokens = config.monitorPairs.map(pair => pair.split('/')[0]);

    for (const token of baseTokens) {
      try {
        const prices = await this.fetchAllPrices(token);
        
        if (prices.length < 2) {
          // Need at least 2 exchanges to arbitrage
          continue;
        }

        const opportunities = this.findArbitrageOpportunities(prices, token);
        
        opportunities.forEach(opp => {
          allOpportunities.push({
            pair: `${token}/${config.baseToken}`,
            ...opp
          });
        });

      } catch (error) {
        console.error(`Error scanning ${token}:`, error.message);
      }

      // Small delay between tokens to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    return allOpportunities;
  }
}
