import { config } from './config.js';
import { dbQueries } from './db/queries.js';

export class PaperTrader {
  constructor() {
    this.balance = this.loadBalance();
  }

  loadBalance() {
    const balanceRecord = dbQueries.getCurrentBalance();
    return balanceRecord ? balanceRecord.balance_usd : config.startingCapital;
  }

  calculateTradeAmount(opportunity) {
    // Use a portion of available balance (e.g., 20% per trade)
    const maxTradeAmount = this.balance * 0.2;
    
    // Calculate expected profit
    const profitPerDollar = (opportunity.sellPrice - opportunity.buyPrice) / opportunity.buyPrice;
    const estimatedProfit = maxTradeAmount * profitPerDollar;

    // Only trade if absolute profit meets minimum
    if (estimatedProfit >= config.minProfitAbsolute) {
      return maxTradeAmount;
    }

    return 0;
  }

  simulateTrade(opportunity) {
    const tradeAmount = this.calculateTradeAmount(opportunity);

    if (tradeAmount === 0) {
      return null;
    }

    // Calculate tokens bought and profit
    const tokensBought = tradeAmount / opportunity.buyPrice;
    const saleProceeds = tokensBought * opportunity.sellPrice;
    const profitUsd = saleProceeds - tradeAmount;
    const profitPercent = (profitUsd / tradeAmount) * 100;

    // Update balance
    this.balance += profitUsd;

    const trade = {
      timestamp: Date.now(),
      pair: opportunity.pair,
      buyExchange: opportunity.buyExchange,
      sellExchange: opportunity.sellExchange,
      buyPrice: opportunity.buyPrice,
      sellPrice: opportunity.sellPrice,
      amount: tradeAmount,
      profitUsd,
      profitPercent,
      simulated: true,
      executed: true,
      notes: `Paper trade: bought ${tokensBought.toFixed(6)} tokens`
    };

    // Record in database
    dbQueries.recordTrade(trade);

    // Update balance record
    const currentStats = dbQueries.getCurrentBalance();
    const newTotalTrades = (currentStats?.total_trades || 0) + 1;
    const newWinningTrades = (currentStats?.winning_trades || 0) + (profitUsd > 0 ? 1 : 0);
    const newTotalProfit = (currentStats?.total_profit || 0) + profitUsd;

    dbQueries.updateBalance(this.balance, newTotalTrades, newWinningTrades, newTotalProfit);

    return trade;
  }

  // Shared interface with LiveTrader
  async executeTrade(opportunity) {
    return this.simulateTrade(opportunity);
  }

  getBalance() {
    return this.balance;
  }

  getStats() {
    const balanceRecord = dbQueries.getCurrentBalance();
    return {
      currentBalance: this.balance,
      startingBalance: config.startingCapital,
      totalProfit: balanceRecord?.total_profit || 0,
      totalTrades: balanceRecord?.total_trades || 0,
      winningTrades: balanceRecord?.winning_trades || 0,
      winRate: balanceRecord?.total_trades > 0 
        ? ((balanceRecord.winning_trades / balanceRecord.total_trades) * 100).toFixed(2)
        : 0
    };
  }
}
