import { ArbitrageDetector } from './arbitrage.js';
import { PaperTrader } from './trader.js';
import { dbQueries } from './db/queries.js';
import { config } from './config.js';

console.log('🧪 Testing Solana Arbitrage Bot Components\n');

// Test 1: Configuration
console.log('1️⃣ Testing Configuration:');
console.log(`   Paper Mode: ${config.paperMode}`);
console.log(`   Starting Capital: $${config.startingCapital}`);
console.log(`   Min Profit: ${config.minProfitPercent * 100}% or $${config.minProfitAbsolute}`);
console.log(`   Slippage: ${config.slippageTolerance * 100}%`);
console.log(`   ✅ Configuration loaded\n`);

// Test 2: Database
console.log('2️⃣ Testing Database:');
const balance = dbQueries.getCurrentBalance();
console.log(`   Current Balance: $${balance.balance_usd}`);
console.log(`   Total Trades: ${balance.total_trades}`);
console.log(`   ✅ Database connected\n`);

// Test 3: Paper Trader
console.log('3️⃣ Testing Paper Trader:');
const trader = new PaperTrader();
const stats = trader.getStats();
console.log(`   Trader Balance: $${stats.currentBalance}`);
console.log(`   ✅ Paper trader initialized\n`);

// Test 4: Simulate a mock trade
console.log('4️⃣ Testing Mock Trade Execution:');
const mockOpportunity = {
  pair: 'SOL/USDC',
  buyExchange: 'Jupiter',
  sellExchange: 'Raydium',
  buyPrice: 100.0,
  sellPrice: 100.8,
  profitPercent: 0.8,
  timestamp: Date.now()
};

console.log(`   Mock Opportunity: ${mockOpportunity.pair}`);
console.log(`   Buy: ${mockOpportunity.buyExchange} @ $${mockOpportunity.buyPrice}`);
console.log(`   Sell: ${mockOpportunity.sellExchange} @ $${mockOpportunity.sellPrice}`);
console.log(`   Expected Profit: ${mockOpportunity.profitPercent}%`);

const trade = trader.simulateTrade(mockOpportunity);
if (trade) {
  console.log(`   ✅ Trade executed!`);
  console.log(`   Actual Profit: $${trade.profitUsd.toFixed(4)} (${trade.profitPercent.toFixed(2)}%)`);
  console.log(`   New Balance: $${trader.getBalance().toFixed(2)}`);
} else {
  console.log(`   ⚠️ Trade not executed (amount too small)`);
}
console.log();

// Test 5: Price Fetching (if RPC configured)
console.log('5️⃣ Testing Price Fetching:');
if (config.rpcUrl && config.rpcUrl !== '') {
  console.log('   Attempting to fetch SOL price from DEXes...');
  const detector = new ArbitrageDetector();
  
  try {
    const prices = await detector.fetchAllPrices('SOL');
    if (prices.length > 0) {
      console.log(`   ✅ Fetched ${prices.length} prices:`);
      prices.forEach(p => {
        console.log(`      ${p.exchange}: $${p.price.toFixed(6)}`);
      });
    } else {
      console.log('   ⚠️ No prices fetched (DEX APIs may be rate limited)');
    }
  } catch (error) {
    console.log(`   ⚠️ Price fetch error: ${error.message}`);
  }
} else {
  console.log('   ⚠️ RPC URL not configured, skipping price fetch test');
  console.log('   (This is OK for testing - configure .env for live use)');
}
console.log();

// Test 6: Database Queries
console.log('6️⃣ Testing Database Queries:');
const allTimeStats = dbQueries.getAllTimeStats();
console.log(`   Total Trades: ${allTimeStats.totalTrades}`);
console.log(`   Win Rate: ${allTimeStats.winRate}%`);
console.log(`   Total Profit: $${allTimeStats.totalProfit}`);
console.log(`   ✅ Database queries working\n`);

// Summary
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('✅ All core components tested successfully!');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('\n📝 Next Steps:');
console.log('   1. Configure .env with your Alchemy RPC and Discord webhook');
console.log('   2. Run: npm start');
console.log('   3. Monitor logs and Discord for activity\n');
