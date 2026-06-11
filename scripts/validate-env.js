/**
 * Environment variable validation script for Solana Arb Bot.
 *
 * Usage: node scripts/validate-env.js
 *
 * Checks:
 *   - Required vars exist and are non-placeholder
 *   - Optional vars warn if missing
 *   - Exit code 0 = config OK, 1 = issues found
 */

const path = require('path');
const fs = require('fs');

// Load .env if present
try {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed.slice(eqIdx + 1).trim();
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    });
  } else {
    console.warn('⚠️  No .env file found — checking process.env only');
  }
} catch (err) {
  console.warn('Could not load .env file:', err.message);
}

const PLACEHOLDER_PATTERNS = [
  /^your_.+_here$/i,
  /^<.*>$/,
  /^REPLACE_ME$/i,
  /^changeme$/i,
];

function isPlaceholder(val) {
  return PLACEHOLDER_PATTERNS.some(p => p.test(val.trim()));
}

// ─── Required vars ──────────────────────────────────────────────────────────────

const REQUIRED = [
  { key: 'RPC_URL', desc: 'Solana RPC endpoint (HTTPS or WSS)' },
  { key: 'WALLET_PRIVATE_KEY', desc: 'Base58-encoded wallet private key' },
];

// ─── Recommended vars ────────────────────────────────────────────────────────────

const RECOMMENDED = [
  { key: 'JUPITER_API_URL', desc: 'Jupiter API URL (default: https://quote-api.jup.ag/v6)' },
  { key: 'MIN_PROFIT_PCT', desc: 'Minimum profit % to execute a trade (default: 0.3)' },
  { key: 'MAX_TRADE_SIZE_SOL', desc: 'Maximum trade size in SOL (default: 0.1)' },
];

// ─── Run checks ─────────────────────────────────────────────────────────────────

let hasErrors = false;
let hasWarnings = false;

console.log('\n🔍 Solana Arb Bot — Environment Validation\n');

// Required
console.log('── Required ──────────────────────────────────────');
for (const { key, desc } of REQUIRED) {
  const val = process.env[key];
  if (!val) {
    console.error(`❌  ${key} — MISSING (${desc})`);
    hasErrors = true;
  } else if (isPlaceholder(val)) {
    console.error(`❌  ${key} — PLACEHOLDER VALUE ("${val}") (${desc})`);
    hasErrors = true;
  } else {
    console.log(`✅  ${key} — set (${val.slice(0, 20)}...)`);
  }
}

// Recommended
console.log('\n── Recommended ───────────────────────────────────');
for (const { key, desc } of RECOMMENDED) {
  const val = process.env[key];
  if (!val) {
    console.warn(`⚠️   ${key} — missing (${desc})`);
    hasWarnings = true;
  } else if (isPlaceholder(val)) {
    console.warn(`⚠️   ${key} — placeholder value (${desc})`);
    hasWarnings = true;
  } else {
    console.log(`✅  ${key} — set`);
  }
}

// Summary
console.log('\n── Summary ──────────────────────────────────────');
if (hasErrors) {
  console.error('❌  Errors found — fix before starting the bot');
} else {
  console.log('✅  No errors');
}
if (hasWarnings) {
  console.warn('⚠️   Warnings present — bot will run with reduced functionality');
} else {
  console.log('✅  No warnings');
}

process.exit(hasErrors ? 1 : 0);