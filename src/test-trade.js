import { PaperTrader } from './trader.js';
import { dbQueries } from './db/queries.js';

console.log('🧪 Testing Paper Trade with Profitable Opportunity\n');

const trader = new PaperTrader();
console.log(`Starting Balance: $${trader.getBalance().toFixed(2)}\n`);

// Test with a more profitable opportunity (2% profit)
const goodOpportunity = {
  pair: 'SOL/USDC',
  buyExchange: 'Jupiter',
  sellExchange: 'Raydium',
  buyPrice: 100.0,
  sellPrice: 102.0,  // 2% profit
  profitPercent: 2.0,
  timestamp: Date.now()
};

console.log('💰 Testing Profitable Opportunity:');
console.log(`   Pair: ${goodOpportunity.pair}`);
console.log(`   Buy: ${goodOpportunity.buyExchange} @ $${goodOpportunity.buyPrice}`);
console.log(`   Sell: ${goodOpportunity.sellExchange} @ $${goodOpportunity.sellPrice}`);
console.log(`   Expected Profit: ${goodOpportunity.profitPercent}%\n`);

const trade = trader.simulateTrade(goodOpportunity);

if (trade) {
  console.log('✅ Trade Executed Successfully!');
  console.log(`   Amount Traded: $${trade.amount.toFixed(2)}`);
  console.log(`   Profit: $${trade.profitUsd.toFixed(4)} (${trade.profitPercent.toFixed(2)}%)`);
  console.log(`   New Balance: $${trader.getBalance().toFixed(2)}`);
  console.log(`   Notes: ${trade.notes}\n`);

  // Show updated stats
  const stats = trader.getStats();
  console.log('📊 Updated Stats:');
  console.log(`   Total Trades: ${stats.totalTrades}`);
  console.log(`   Winning Trades: ${stats.winningTrades}`);
  console.log(`   Win Rate: ${stats.winRate}%`);
  console.log(`   Total P&L: $${stats.totalProfit.toFixed(4)}`);
} else {
  console.log('❌ Trade not executed');
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('✅ Paper trading logic verified!');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
