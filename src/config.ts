import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return val;
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function parseFloat_(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const val = parseFloat(raw);
  if (isNaN(val)) throw new Error(`Invalid float for ${key}: ${raw}`);
  return val;
}

function parseInt_(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const val = parseInt(raw, 10);
  if (isNaN(val)) throw new Error(`Invalid integer for ${key}: ${raw}`);
  return val;
}

function parseBool(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (!raw) return fallback;
  return raw.toLowerCase() === 'true' || raw === '1';
}

export interface Config {
  rpcUrl: string;
  rpcWsUrl: string;
  walletPrivateKey: string;
  jitoUuid: string;
  jitoEndpoint: string;
  jitoTipAccount: string;
  jitoTipLamports: bigint;
  minProfitPct: number;
  minProfitUsd: number;
  tradeSizeSol: number;
  maxSlippageBps: number;
  scanIntervalMs: number;
  dryRun: boolean;
  maxTradesPerMinute: number;
}

let _config: Config | null = null;

export function loadConfig(): Config {
  if (_config) return _config;

  _config = {
    rpcUrl: optionalEnv('RPC_URL', 'https://api.mainnet-beta.solana.com'),
    rpcWsUrl: optionalEnv('RPC_WS_URL', 'wss://api.mainnet-beta.solana.com'),
    walletPrivateKey: requireEnv('WALLET_PRIVATE_KEY'),
    jitoUuid: optionalEnv('JITO_UUID', ''),
    jitoEndpoint: 'https://mainnet.block-engine.jito.wtf/api/v1/bundles',
    jitoTipAccount: '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
    jitoTipLamports: BigInt(parseInt_(('JITO_TIP_LAMPORTS'), 10000)),
    minProfitPct: parseFloat_('MIN_PROFIT_PCT', 1.0),
    minProfitUsd: parseFloat_('MIN_PROFIT_USD', 0.50),
    tradeSizeSol: parseFloat_('TRADE_SIZE_SOL', 0.1),
    maxSlippageBps: parseInt_('MAX_SLIPPAGE_BPS', 50),
    scanIntervalMs: parseInt_('SCAN_INTERVAL_MS', 1000),
    dryRun: parseBool('DRY_RUN', true),
    maxTradesPerMinute: parseInt_('MAX_TRADES_PER_MINUTE', 5),
  };

  return _config;
}

export function validateConfig(cfg: Config): void {
  if (!cfg.walletPrivateKey) throw new Error('WALLET_PRIVATE_KEY is required');
  if (cfg.tradeSizeSol <= 0) throw new Error('TRADE_SIZE_SOL must be positive');
  if (cfg.maxSlippageBps < 0 || cfg.maxSlippageBps > 10000) {
    throw new Error('MAX_SLIPPAGE_BPS must be 0-10000');
  }
  if (cfg.scanIntervalMs < 100) {
    throw new Error('SCAN_INTERVAL_MS too low (min 100ms)');
  }
  if (!cfg.dryRun && !cfg.jitoUuid) {
    throw new Error('JITO_UUID is required when DRY_RUN=false');
  }
}
