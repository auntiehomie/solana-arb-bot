// Quick test of updated arbitrage detector
import { ArbitrageDetector } from './src/arbitrage.js';

async function test() {
  console.log('🧪 Testing updated arbitrage detector with DexScreener...\n');
  
  const detector = new ArbitrageDetector();
  
  console.log('Fetching SOL prices from all DEXes...');
  const prices = await detector.fetchAllPrices('SOL');
  
  if (prices.length === 0) {
    console.log('❌ No prices found');
    return;
  }
  
  console.log(`✅ Found ${prices.length} DEX prices:\n`);
  prices.forEach(p => {
    console.log(`   ${p.exchange}: $${p.price.toFixed(6)} (liquidity: $${(p.liquidity/1000).toFixed(1)}k)`);
  });
  
  console.log('\n🔍 Checking for arbitrage opportunities...');
  const opportunities = detector.findArbitrageOpportunities(prices);
  
  if (opportunities.length === 0) {
    console.log('No profitable opportunities found (this is normal!)');
  } else {
    console.log(`\n💰 Found ${opportunities.length} opportunities:`);
    opportunities.forEach((opp, i) => {
      console.log(`\n${i + 1}. ${opp.buyExchange} → ${opp.sellExchange}`);
      console.log(`   Buy: $${opp.buyPrice.toFixed(6)}`);
      console.log(`   Sell: $${opp.sellPrice.toFixed(6)}`);
      console.log(`   Profit: ${opp.profitPercent.toFixed(3)}%`);
    });
  }
  
  console.log('\n✅ Bot is working! DexScreener integration successful.');
}

test().catch(console.error);
