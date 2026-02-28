import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const config = {
  // RPC Configuration
  rpcUrl: process.env.SOLANA_RPC_URL || '',
  // Helius RPC for WebSocket subscriptions (Alchemy free tier doesn't support them)
  heliusRpcUrl: process.env.HELIUS_RPC_URL || '',
  
  // Discord
  discordWebhook: process.env.DISCORD_WEBHOOK_URL || '',
  
  // Trading mode
  // PAPER_MODE=true  → PaperTrader (simulated, safe)
  // PAPER_MODE=false → LiveTrader  (real on-chain)
  paperMode: process.env.PAPER_MODE !== 'false',

  // DRY_RUN only applies in live mode:
  //   true  → builds + signs tx but never submits (default: safe)
  //   false → real transactions submitted ⚠️
  dryRun: process.env.DRY_RUN !== 'false',

  startingCapital: parseFloat(process.env.STARTING_CAPITAL || '20'),
  slippageTolerance: parseFloat(process.env.SLIPPAGE_TOLERANCE || '0.04'),
  minProfitPercent: parseFloat(process.env.MIN_PROFIT_PERCENT || '0.0167'),
  minProfitAbsolute: parseFloat(process.env.MIN_PROFIT_ABSOLUTE || '0.17'),

  // Cleanup / dust thresholds (USD)
  // CLEANUP_MIN_USD: don't auto-cleanup tiny token balances below this value
  // DUST_USD: ignore tiny token balances entirely when considering auto-sell
  cleanupMinUsd: parseFloat(process.env.CLEANUP_MIN_USD || '0.50'),
  dustUsd: parseFloat(process.env.DUST_USD || '0.50'),

  // Live trading safety limits
  maxTradeAmountUsd: parseFloat(process.env.MAX_TRADE_AMOUNT_USD || '10'),
  maxDailyLossUsd:   parseFloat(process.env.MAX_DAILY_LOSS_USD   || '2'),
  // Number of extra sell retries (total attempts = sellRetryCount + 1)
  sellRetryCount:    parseInt(process.env.SELL_RETRY_COUNT || '3'),

  // Minimum SOL to keep in wallet for transaction fees.
  // Each tx costs ~0.000005 SOL base + up to ~0.001 SOL priority fee.
  // Two legs per arb = ~0.002 SOL max per round-trip.
  // Default 0.01 SOL covers ~5 round-trips — well below $2 even at high SOL prices.
  // Raise this if you're doing high-frequency trading.
  solGasReserve: parseFloat(process.env.SOL_GAS_RESERVE || '0.01'),
  
  // Rate Limiting
  updateIntervalMs: process.env.UPDATE_INTERVAL_MS
    ? parseInt(process.env.UPDATE_INTERVAL_MS)
    : (parseInt(process.env.UPDATE_INTERVAL || '15')) * 60 * 1000,
  
  // Database
  dbPath: process.env.DB_PATH || join(dirname(__dirname), 'data', 'trading.db'),
  
  // Base trading token (SOL)
  baseToken: process.env.BASE_TOKEN || 'SOL',
  baseMint:  'So11111111111111111111111111111111111111112',

  // Monitoring – SOL-denominated pairs (no SOL/SOL, use alts vs SOL)
  monitorPairs: (process.env.MONITOR_PAIRS || 'RAY/SOL,BONK/SOL,JUP/SOL,ORCA/SOL').split(',').map(p => p.trim()),
  
  // DEX APIs
  jupiterApi: process.env.JUPITER_API || 'https://price.jup.ag/v6',
  raydiumApi: process.env.RAYDIUM_API || 'https://api-v3.raydium.io',
  phoenixEnabled: process.env.PHOENIX_ENABLED === 'true',
  
  // Token addresses (Solana mainnet)
  tokens: {
    'SOL': 'So11111111111111111111111111111111111111112',
    'USDC': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    'RAY': '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
    'BONK': 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    'USDT': 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    'JUP':  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
    'ORCA': 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE'
  }
};

// Token mint addresses mapping
export const getTokenMint = (symbol) => {
  return config.tokens[symbol.toUpperCase()] || null;
};
