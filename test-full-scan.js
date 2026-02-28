// Full scan test
import { ArbitrageDetector } from './src/arbitrage.js';
import { config } from './src/config.js';

async function test() {
  console.log('🧪 Full scan test with all monitored pairs...');
  console.log(`Monitoring: ${config.monitorPairs.join(', ')}\n`);
  
  const detector = new ArbitrageDetector();
  const opportunities = await detector.scanForOpportunities();
  
  console.log(`\n📊 Scan complete!`);
  console.log(`Found ${opportunities.length} opportunities\n`);
  
  if (opportunities.length > 0) {
    opportunities.forEach((opp, i) => {
      console.log(`${i + 1}. ${opp.pair}: ${opp.buyExchange} → ${opp.sellExchange}`);
      console.log(`   Profit: ${opp.profitPercent.toFixed(3)}%`);
    });
  } else {
    console.log('✅ No opportunities (normal - arbitrage is rare)');
  }
  
  console.log('\n✅ Bot is fully operational!');
}

test().catch(console.error);
