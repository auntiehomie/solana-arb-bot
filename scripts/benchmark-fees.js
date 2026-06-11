/**
 * Fee benchmark script for Solana Arb Bot.
 *
 * Runs calcNetProfit for standard trade sizes and prints a fee cost table.
 * Usage: npx ts-node scripts/benchmark-fees.js
 *
 * Estimates Solana tx fees (base + priority + optional Jito tip) and shows
 * the net profit threshold needed for a trade to be profitable.
 */

const path = require('path');

// Load .env for config values
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch {
  // dotenv not available — use defaults
}

// Fee constants (in lamports)
const BASE_FEE_LAMPORTS = 5_000n;
const PRIORITY_FEE_ESTIMATE = 25_000n;
const JITO_TIP_DEFAULT = BigInt(process.env.JITO_TIP_LAMPORTS || 10_000);

const SOL_USD = parseFloat(process.env.SOL_USD_PRICE || '150');

// Trade sizes to benchmark (in SOL)
const TRADE_SIZES_SOL = [0.05, 0.1, 0.5, 1.0, 2.0];

// Network fees for 2-leg arb (2 txs)
const NETWORK_FEES_2LEG = Number((BASE_FEE_LAMPORTS + PRIORITY_FEE_ESTIMATE) * 2n) / 1e9;
const NETWORK_FEES_WITH_JITO = Number((BASE_FEE_LAMPORTS + PRIORITY_FEE_ESTIMATE) * 2n + JITO_TIP_DEFAULT) / 1e9;

console.log('\n═══════════════════════════════════════════════');
console.log('  Solana Arb Bot — Fee Benchmark');
console.log('═══════════════════════════════════════════════\n');
console.log(`SOL price: $${SOL_USD.toFixed(2)}`);
console.log(`Network fees (2-leg): ${(NETWORK_FEES_2LEG * 1e9).toFixed(0)} lamports ($${(NETWORK_FEES_2LEG * SOL_USD).toFixed(4)})`);
console.log(`Jito tip: ${Number(JITO_TIP_DEFAULT).toFixed(0)} lamports`);
console.log(`Total w/ Jito: ${(NETWORK_FEES_WITH_JITO * 1e9).toFixed(0)} lamports ($${(NETWORK_FEES_WITH_JITO * SOL_USD).toFixed(4)})`);

console.log('\n── Trade size vs fee floor ─────────────────────');
console.log('Trade (SOL)  │ Fee floor %   │ Fee floor %   │ Min profit (no Jito) │ Min profit (w/ Jito)');
console.log('             │ (no Jito)     │ (w/ Jito)     │ USD                  │ USD');
console.log('─────────────┼───────────────┼───────────────┼──────────────────────┼──────────────────────');

for (const sol of TRADE_SIZES_SOL) {
  const feeFloorPctNoJito = (NETWORK_FEES_2LEG / sol) * 100;
  const feeFloorPctJito = (NETWORK_FEES_WITH_JITO / sol) * 100;
  const minProfitNoJito = NETWORK_FEES_2LEG * SOL_USD;
  const minProfitJito = NETWORK_FEES_WITH_JITO * SOL_USD;

  console.log(
    `${sol.toFixed(2).padStart(9)} SOL │ ` +
    `${feeFloorPctNoJito.toFixed(4).padStart(11)}% │ ` +
    `${feeFloorPctJito.toFixed(4).padStart(11)}% │ ` +
    `$${minProfitNoJito.toFixed(4).padStart(12)} │ ` +
    `$${minProfitJito.toFixed(4).padStart(12)}`
  );
}

console.log('\n── Recommendations ────────────────────────────');
for (const sol of TRADE_SIZES_SOL) {
  const floor = (NETWORK_FEES_2LEG / sol) * 100;
  const floorJito = (NETWORK_FEES_WITH_JITO / sol) * 100;
  if (sol <= 0.1) {
    console.log(`  • ${sol.toFixed(2)} SOL: fee floor = ${floor.toFixed(3)}% (${floorJito.toFixed(3)}% w/ Jito)`);
    console.log(`    → Set MIN_PROFIT_PCT to at least ${Math.ceil(floorJito * 2)}% for ${sol.toFixed(2)} SOL trades`);
  }
}

console.log('\n✅ Benchmark complete');