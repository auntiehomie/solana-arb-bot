import { config } from './config.js';
import { ArbitrageDetector } from './arbitrage.js';
import { PaperTrader } from './trader.js';
import { LiveTrader } from './live-trader.js';
import { DiscordNotifier } from './discord.js';
import { Scheduler } from './scheduler.js';
import { dbQueries } from './db/queries.js';
import { WSMonitor } from './ws-monitor.js';

// Fallback polling interval when WS is idle (3 minutes)
const FALLBACK_POLL_MS = 3 * 60 * 1000;

class SolanaArbitrageBot {
  constructor() {
    this.detector  = new ArbitrageDetector();
    this.trader    = config.paperMode ? new PaperTrader() : new LiveTrader();
    this.discord   = new DiscordNotifier();
    this.scheduler = new Scheduler(this.trader);
    this.wsMonitor = new WSMonitor((dex) => this._onSwapEvent(dex));
    this.running   = false;
    this.scanning  = false;
    this.opportunitiesFound = 0;
    this.tradesExecuted     = 0;
    this.fallbackTimer      = null;
  }

  async start() {
    console.log('🤖 Starting Solana Arbitrage Bot...');
    // Log effective runtime config for auditing
    console.log(`   Runtime minProfitAbsolute: $${config.minProfitAbsolute}`);
    console.log(`   Runtime minProfitPercent: ${(config.minProfitPercent*100).toFixed(3)}%`);

    console.log(`Mode: ${config.paperMode ? 'PAPER TRADING' : 'LIVE TRADING'}`);
    console.log(`Starting capital: $${config.startingCapital} (will update from wallet on-chain)`);
    console.log(`Monitoring: ${config.monitorPairs.join(', ')}`);
    console.log(`Price source: Jupiter Quote API (real-time) with DexScreener fallback`);

    // Seed balance from real on-chain balance (live mode only)
    if (!config.paperMode && typeof this.trader.init === 'function') {
      await this.trader.init();
    }

    await this.discord.sendStartup();

    this.running = true;

    // Start WebSocket monitor — this drives scanning
    await this.wsMonitor.start();

    // Fallback: if no WS events arrive in FALLBACK_POLL_MS, scan anyway
    this._resetFallbackTimer();

    // Initial scan on boot
    await this.scanAndTrade();
  }

  // Called by WSMonitor when a real on-chain swap is detected
  async _onSwapEvent(dex) {
    if (this.scanning) return; // already mid-scan, drop this trigger
    console.log(`\n⚡ WS trigger: ${dex} swap detected`);
    this._resetFallbackTimer();
    await this.scanAndTrade();
  }

  _resetFallbackTimer() {
    if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
    this.fallbackTimer = setTimeout(async () => {
      console.log(`\n[Fallback poll] No WS events in ${FALLBACK_POLL_MS / 60000} min — scanning anyway`);
      await this.scanAndTrade();
      this._resetFallbackTimer();
    }, FALLBACK_POLL_MS);
  }

  async scanAndTrade() {
    this.scanning = true;
    console.log(`\n[${new Date().toISOString()}] Scanning for opportunities...`);

    const opportunities = await this.detector.scanForOpportunities();

    if (opportunities.length === 0) {
      console.log('No arbitrage opportunities found');
      this.scanning = false;
      return;
    }

    console.log(`Found ${opportunities.length} potential opportunities`);
    this.opportunitiesFound += opportunities.length;

    // Record opportunities in DB
    opportunities.forEach(opp => {
      dbQueries.recordOpportunity({
        timestamp: Date.now(),
        pair: opp.pair,
        buyExchange: opp.buyExchange,
        sellExchange: opp.sellExchange,
        profitPercent: opp.profitPercent,
        priceBuy: opp.buyPrice,
        priceSell: opp.sellPrice,
        taken: false
      });
    });

    // Sort by profit and take best opportunities
    const sortedOpps = opportunities.sort((a, b) => b.profitPercent - a.profitPercent);

    for (const opp of sortedOpps.slice(0, 3)) { // Top 3 opportunities
      console.log(`\n💰 Opportunity: ${opp.pair}`);
      console.log(`   Buy on ${opp.buyExchange} @ $${opp.buyPrice.toFixed(6)}`);
      console.log(`   Sell on ${opp.sellExchange} @ $${opp.sellPrice.toFixed(6)}`);
      console.log(`   Profit: ${opp.profitPercent.toFixed(3)}%`);

      // Execute trade (paper or live depending on config)
      const trade = await this.trader.executeTrade(opp);

      if (trade) {
        this.tradesExecuted++;
        console.log(`   ✅ Trade executed! Profit: $${trade.profitUsd.toFixed(4)}`);
        console.log(`   New balance: $${this.trader.getBalance().toFixed(2)}`);

        // Send to Discord
        await this.discord.sendTrade(trade);

        // Mark opportunity as taken
        // Ensure DB field names match the opportunities object (avoid spreading opp directly)
        dbQueries.recordOpportunity({
          timestamp: Date.now(),
          pair: opp.pair,
          buyExchange: opp.buyExchange,
          sellExchange: opp.sellExchange,
          profitPercent: opp.profitPercent,
          priceBuy: opp.buyPrice,
          priceSell: opp.sellPrice,
          taken: true
        });
      } else {
        // null = skipped (unprofitable real quote, pre-filter, or gas check)
        // detailed reason already logged inside executeTrade
      }
    }

    // Print session stats
    const stats = this.trader.getStats();
    const wsStats = this.wsMonitor.getStats();
    console.log(`\n📊 Session Stats:`);
    console.log(`   Opportunities found: ${this.opportunitiesFound}`);
    console.log(`   Trades executed:     ${this.tradesExecuted}`);
    console.log(`   Current balance:     $${stats.currentBalance.toFixed(2)}`);
    console.log(`   Total P&L:           $${stats.totalProfit.toFixed(4)}`);
    console.log(`   Win rate:            ${stats.winRate}%`);
    console.log(`   WS swap events:      ${wsStats.swapEventCount}`);
    console.log(`   WS-triggered scans:  ${wsStats.triggeredScans}`);

    this.scanning = false;
  }

  stop() {
    console.log('\n🛑 Stopping bot...');
    this.running = false;
    if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
    this.wsMonitor.stop();
  }
}

// Handle graceful shutdown
const bot = new SolanaArbitrageBot();

process.on('SIGINT', () => {
  bot.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  bot.stop();
  process.exit(0);
});

// Start the bot
bot.start().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
