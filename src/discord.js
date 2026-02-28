import axios from 'axios';
import { config } from './config.js';

export class DiscordNotifier {
  constructor() {
    this.webhookUrl = config.discordWebhook;
    this.enabled = !!this.webhookUrl && this.webhookUrl !== 'YOUR_DISCORD_WEBHOOK_URL_HERE';
  }

  async send(content, embeds = null) {
    if (!this.enabled) {
      console.log('[Discord] Webhook not configured, skipping notification');
      return;
    }

    try {
      const payload = { content };
      if (embeds) {
        payload.embeds = Array.isArray(embeds) ? embeds : [embeds];
      }

      await axios.post(this.webhookUrl, payload, {
        timeout: 5000
      });
    } catch (error) {
      console.error('[Discord] Failed to send notification:', error.message);
    }
  }

  async sendStartup() {
    const embed = {
      title: '🤖 Solana Arbitrage Bot Started',
      color: 0x00ff00,
      fields: [
        {
          name: 'Mode',
          value: config.paperMode ? '📝 Paper Trading' : '💰 Live Trading',
          inline: true
        },
        {
          name: 'Starting Capital',
          value: `$${config.startingCapital} USDC`,
          inline: true
        },
        {
          name: 'Monitoring',
          value: config.monitorPairs.join(', '),
          inline: false
        },
        {
          name: 'Min Profit',
          value: `${(config.minProfitPercent * 100).toFixed(2)}% or $${config.minProfitAbsolute}`,
          inline: true
        },
        {
          name: 'Slippage',
          value: `${(config.slippageTolerance * 100).toFixed(1)}%`,
          inline: true
        }
      ],
      timestamp: new Date().toISOString()
    };

    await this.send('', embed);
  }

  async sendTrade(trade) {
    const emoji = trade.profitUsd > 0 ? '✅' : '❌';
    const color = trade.profitUsd > 0 ? 0x00ff00 : 0xff0000;

    // Extract tx ids from notes if present
    let buyTx = null, sellTx = null;
    if (trade.notes) {
      const mBuy = trade.notes.match(/buy_tx=([^\s]+)/);
      const mSell = trade.notes.match(/sell_tx=([^\s]+)/);
      buyTx = mBuy ? mBuy[1] : null;
      sellTx = mSell ? mSell[1] : null;
    }

    const fields = [
      { name: 'Pair', value: trade.pair, inline: true },
      { name: 'Route', value: `${trade.buyExchange} → ${trade.sellExchange}`, inline: true },
      { name: 'Amount', value: `$${trade.amount.toFixed(2)}`, inline: true },
      { name: 'Buy Price', value: `$${trade.buyPrice.toFixed(6)}`, inline: true },
      { name: 'Sell Price', value: `$${trade.sellPrice.toFixed(6)}`, inline: true },
      { name: 'Profit', value: `$${trade.profitUsd.toFixed(4)} (${trade.profitPercent.toFixed(2)}%)`, inline: true }
    ];

    if (buyTx) fields.push({ name: 'Buy TX', value: `https://solscan.io/tx/${buyTx}`, inline: true });
    if (sellTx) fields.push({ name: 'Sell TX', value: `https://solscan.io/tx/${sellTx}`, inline: true });

    const embed = {
      title: `${emoji} ${trade.simulated ? 'Simulated' : 'Live'} Trade Executed`,
      color,
      fields,
      timestamp: new Date(trade.timestamp).toISOString(),
      footer: { text: trade.simulated ? '📝 Paper/DRY_RUN' : '💸 Live Trade' }
    };

    await this.send('', embed);
  }

  async sendDailySummary(stats) {
    const balance = stats.currentBalance || 0;
    const profit = stats.totalProfit || 0;
    const emoji = profit >= 0 ? '📈' : '📉';

    const embed = {
      title: `${emoji} Daily Trading Summary`,
      color: profit >= 0 ? 0x00ff00 : 0xff0000,
      fields: [
        {
          name: 'Current Balance',
          value: `$${balance.toFixed(2)}`,
          inline: true
        },
        {
          name: 'Total Profit/Loss',
          value: `$${profit.toFixed(4)}`,
          inline: true
        },
        {
          name: 'Total Trades',
          value: `${stats.totalTrades || 0}`,
          inline: true
        },
        {
          name: 'Win Rate',
          value: `${stats.winRate || 0}%`,
          inline: true
        },
        {
          name: 'Best Trade',
          value: stats.bestTrade 
            ? `${stats.bestTrade.pair}: $${stats.bestTrade.profit_usd.toFixed(4)}`
            : 'N/A',
          inline: false
        }
      ],
      timestamp: new Date().toISOString(),
      footer: {
        text: '📊 Daily Summary • Paper Trading'
      }
    };

    await this.send('', embed);
  }

  async sendBiweeklyReport(stats) {
    const emoji = stats.totalProfit >= 0 ? '🎉' : '😔';
    const color = stats.totalProfit >= 0 ? 0xffd700 : 0xff6b6b;

    const bestPairsText = stats.bestPairs.length > 0
      ? stats.bestPairs.map(([pair, data]) => 
          `${pair}: ${data.count} trades, $${data.profit.toFixed(4)}`
        ).join('\n')
      : 'No trades yet';

    const embed = {
      title: `${emoji} Biweekly Performance Report`,
      color,
      description: '📊 Trading performance over the last 14 days',
      fields: [
        {
          name: 'Total Trades',
          value: `${stats.totalTrades}`,
          inline: true
        },
        {
          name: 'Win Rate',
          value: `${stats.winRate}%`,
          inline: true
        },
        {
          name: 'Total Profit/Loss',
          value: `$${parseFloat(stats.totalProfit).toFixed(4)}`,
          inline: true
        },
        {
          name: 'Avg Profit/Trade',
          value: `$${stats.avgProfitPerTrade}`,
          inline: true
        },
        {
          name: 'Winning Trades',
          value: `${stats.winningTrades}`,
          inline: true
        },
        {
          name: 'Losing Trades',
          value: `${stats.totalTrades - stats.winningTrades}`,
          inline: true
        },
        {
          name: '🏆 Best Performing Pairs',
          value: bestPairsText,
          inline: false
        }
      ],
      timestamp: new Date().toISOString(),
      footer: {
        text: '📈 Biweekly Report • Paper Trading Mode'
      }
    };

    await this.send('', embed);
  }

  async sendError(error) {
    const embed = {
      title: '⚠️ Bot Error',
      color: 0xff0000,
      description: error.message || 'Unknown error occurred',
      timestamp: new Date().toISOString()
    };

    await this.send('', embed);
  }
}
