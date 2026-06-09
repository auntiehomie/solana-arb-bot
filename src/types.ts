// ─── Core token types ────────────────────────────────────────────────────────

export interface Token {
  symbol: string;
  mint: string;
  decimals: number;
}

export const TOKENS: Record<string, Token> = {
  SOL: {
    symbol: 'SOL',
    mint: 'So11111111111111111111111111111111111111112',
    decimals: 9,
  },
  JUP: {
    symbol: 'JUP',
    mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
    decimals: 6,
  },
  PENGU: {
    symbol: 'PENGU',
    mint: '2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv',
    decimals: 6,
  },
  BONK: {
    symbol: 'BONK',
    mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    decimals: 5,
  },
  USDC: {
    symbol: 'USDC',
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    decimals: 6,
  },
};

export type TokenSymbol = keyof typeof TOKENS;

// ─── DEX identifiers ─────────────────────────────────────────────────────────

export type DexName = 'Jupiter' | 'Raydium' | 'Orca' | 'Meteora';

// ─── Quote types ──────────────────────────────────────────────────────────────

/** A normalised DEX quote */
export interface DexQuote {
  dex: DexName;
  inputMint: string;
  outputMint: string;
  inputAmount: bigint;   // in lamports / smallest unit
  outputAmount: bigint;  // in lamports / smallest unit
  /** Price as outputAmount / inputAmount (already decimal-adjusted) */
  price: number;
  /** Raw API response, kept for swap-transaction building */
  raw?: unknown;
  fetchedAt: number;     // unix ms
}

/** Quotes keyed by dex name for a given pair */
export interface PairQuotes {
  inputSymbol: string;
  outputSymbol: string;
  quotes: DexQuote[];
}

// ─── Opportunity types ────────────────────────────────────────────────────────

export interface ArbitrageOpportunity {
  id: string;
  inputSymbol: string;
  outputSymbol: string;
  buyDex: DexName;
  sellDex: DexName;
  buyQuote: DexQuote;
  sellQuote: DexQuote;
  /** In token-native units */
  inputAmount: bigint;
  expectedOutputAfterSell: bigint;
  /** Gross profit in input-token units */
  profitAmount: bigint;
  profitPct: number;
  profitUsd: number;
  detectedAt: number;
  isTriangular?: boolean;
  triangularPath?: string;
  triangularLegs?: DexQuote[];
}

// ─── Jito types ───────────────────────────────────────────────────────────────

export interface JitoBundleRequest {
  jsonrpc: '2.0';
  id: number;
  method: 'sendBundle';
  params: [string[]];  // array of base64-encoded transactions
}

export interface JitoBundleResponse {
  jsonrpc: string;
  id: number;
  result?: string;  // bundle id
  error?: {
    code: number;
    message: string;
  };
}

// ─── Execution result ─────────────────────────────────────────────────────────

export interface ExecutionResult {
  opportunity: ArbitrageOpportunity;
  bundleId?: string;
  success: boolean;
  dryRun: boolean;
  error?: string;
  executedAt: number;
  tipLamports: bigint;
}

// ─── USD price map ────────────────────────────────────────────────────────────

export type UsdPrices = Record<string, number>;  // symbol → USD price

// ─── Scan metrics ─────────────────────────────────────────────────────────────

export interface ScanMetrics {
  scanNumber: number;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  quotesTotal: number;
  quotesFailed: number;
  opportunitiesFound: number;
  tradesExecuted: number;
  errors: string[];
}
