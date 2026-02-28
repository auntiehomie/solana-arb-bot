import db from './init.js';

export const dbQueries = {
  // Get current balance
  getCurrentBalance() {
    return db.prepare('SELECT * FROM balance ORDER BY timestamp DESC LIMIT 1').get();
  },

  // Update balance
  updateBalance(balanceUsd, totalTrades, winningTrades, totalProfit) {
    return db.prepare(`
      INSERT INTO balance (timestamp, balance_usd, total_trades, winning_trades, total_profit)
      VALUES (?, ?, ?, ?, ?)
    `).run(Date.now(), balanceUsd, totalTrades, winningTrades, totalProfit);
  },

  // Record trade
  recordTrade(trade) {
    return db.prepare(`
      INSERT INTO trades (
        timestamp, pair, buy_exchange, sell_exchange,
        buy_price, sell_price, amount, profit_usd,
        profit_percent, simulated, executed, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      trade.timestamp,
      trade.pair,
      trade.buyExchange,
      trade.sellExchange,
      trade.buyPrice,
      trade.sellPrice,
      trade.amount,
      trade.profitUsd,
      trade.profitPercent,
      trade.simulated ? 1 : 0,
      trade.executed ? 1 : 0,
      trade.notes || null
    );
  },

  // Record opportunity (not taken)
  recordOpportunity(opp) {
    // Runtime assertions to ensure DB-required fields are present
    const missing = [];
    if (!opp.timestamp) missing.push('timestamp');
    if (!opp.pair) missing.push('pair');
    if (!opp.buyExchange) missing.push('buyExchange');
    if (!opp.sellExchange) missing.push('sellExchange');
    if (typeof opp.profitPercent === 'undefined' || opp.profitPercent === null) missing.push('profitPercent');
    if (typeof opp.priceBuy === 'undefined' || opp.priceBuy === null) missing.push('priceBuy');
    if (typeof opp.priceSell === 'undefined' || opp.priceSell === null) missing.push('priceSell');

    if (missing.length > 0) {
      const msg = `recordOpportunity missing required fields: ${missing.join(', ')}`;
      console.error(msg, opp);
      throw new Error(msg);
    }

    return db.prepare(`
      INSERT INTO opportunities (
        timestamp, pair, buy_exchange, sell_exchange,
        profit_percent, price_buy, price_sell, taken
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      opp.timestamp,
      opp.pair,
      opp.buyExchange,
      opp.sellExchange,
      opp.profitPercent,
      opp.priceBuy,
      opp.priceSell,
      opp.taken ? 1 : 0
    );
  },

  // Get trades in time range
  getTradesInRange(startTime, endTime) {
    return db.prepare(`
      SELECT * FROM trades
      WHERE timestamp BETWEEN ? AND ?
      ORDER BY timestamp DESC
    `).all(startTime, endTime);
  },

  // Get daily stats
  getDailyStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startOfDay = today.getTime();
    const endOfDay = startOfDay + 86400000;

    const trades = this.getTradesInRange(startOfDay, endOfDay);
    const totalProfit = trades.reduce((sum, t) => sum + t.profit_usd, 0);
    const bestTrade = trades.length > 0 
      ? trades.reduce((best, t) => t.profit_percent > best.profit_percent ? t : best)
      : null;

    return {
      totalTrades: trades.length,
      totalProfit,
      bestTrade,
      trades
    };
  },

  // Get biweekly stats
  getBiweeklyStats() {
    const now = Date.now();
    const twoWeeksAgo = now - (14 * 86400000);

    const trades = this.getTradesInRange(twoWeeksAgo, now);
    const winningTrades = trades.filter(t => t.profit_usd > 0).length;
    const totalProfit = trades.reduce((sum, t) => sum + t.profit_usd, 0);
    
    // Group by pair
    const pairStats = {};
    trades.forEach(t => {
      if (!pairStats[t.pair]) {
        pairStats[t.pair] = { count: 0, profit: 0 };
      }
      pairStats[t.pair].count++;
      pairStats[t.pair].profit += t.profit_usd;
    });

    const bestPairs = Object.entries(pairStats)
      .sort((a, b) => b[1].profit - a[1].profit)
      .slice(0, 5);

    return {
      totalTrades: trades.length,
      winningTrades,
      winRate: trades.length > 0 ? (winningTrades / trades.length * 100).toFixed(2) : 0,
      totalProfit,
      bestPairs,
      avgProfitPerTrade: trades.length > 0 ? (totalProfit / trades.length).toFixed(4) : 0
    };
  },

  // Get all-time stats
  getAllTimeStats() {
    const allTrades = db.prepare('SELECT * FROM trades ORDER BY timestamp DESC').all();
    const winningTrades = allTrades.filter(t => t.profit_usd > 0).length;
    const totalProfit = allTrades.reduce((sum, t) => sum + t.profit_usd, 0);

    return {
      totalTrades: allTrades.length,
      winningTrades,
      winRate: allTrades.length > 0 ? (winningTrades / allTrades.length * 100).toFixed(2) : 0,
      totalProfit: totalProfit.toFixed(4),
      avgProfitPerTrade: allTrades.length > 0 ? (totalProfit / allTrades.length).toFixed(4) : 0
    };
  }
};
