/**
 * Fee modeling for Solana arbitrage profitability.
 *
 * Solana transaction costs have two components:
 *   1. Base transaction fee — 5,000 lamports per signature (typically 1 sig/tx)
 *      For a 2-leg arb: 2 txs × 5,000 = 10,000 lamports
 *   2. Priority fee — dynamic, set via `prioritizationFeeLamports: 'auto'`
 *      Jupiter's auto mode typically adds 1,000–50,000 lamports per tx.
 *      We conservatively estimate 25,000 lamports per tx = 50,000 total.
 *   3. Jito tip — minimum 10,000 lamports (from config), often higher in competition
 *
 * Note: Jupiter routing is 0% protocol fee for most routes (as of 2024/2025).
 * Slippage is already baked into quote outAmounts via slippageBps parameter.
 *
 * Total floor cost estimate for a 2-leg arb (no Jito):
 *   base fees:     10,000 lamports
 *   priority fees: 50,000 lamports (est.)
 *   ─────────────────────────────────────
 *   Total:         60,000 lamports ≈ $0.009 at $150 SOL
 *
 * With Jito (live execution):
 *   above + jito tip (min 10,000 lamports, often 50,000–200,000 for competitive slots)
 *
 * We expose this as a function so callers can compute net profit correctly
 * rather than comparing gross quote output against input.
 */

import { UsdPrices } from '../types';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Base fee per transaction signature (network fee floor) */
export const BASE_FEE_LAMPORTS = 5_000n;

/** Conservative priority fee estimate per tx (auto mode typically uses this range) */
export const PRIORITY_FEE_ESTIMATE_LAMPORTS = 25_000n;

/** Total Solana network fees for a 2-leg arb (2 txs, 1 sig each) */
export const NETWORK_FEES_2LEG_LAMPORTS =
  (BASE_FEE_LAMPORTS + PRIORITY_FEE_ESTIMATE_LAMPORTS) * 2n;  // 60,000 lamports

/** Default Jito tip (matches config default, minimum competitive tip) */
export const DEFAULT_JITO_TIP_LAMPORTS = 10_000n;

/** Typical competitive Jito tip for mainnet (used in live estimates) */
export const COMPETITIVE_JITO_TIP_LAMPORTS = 50_000n;

// ─── Fee estimation ────────────────────────────────────────────────────────────

export interface FeeEstimate {
  /** Total fees in SOL lamports */
  feeLamports: bigint;
  /** Total fees in USD (0 if SOL price unknown) */
  feeUsd: number;
  /** Whether Jito tip was included */
  includesJitoTip: boolean;
}

/**
 * Estimate total execution cost for a 2-leg Jupiter arb.
 *
 * @param jitoTipLamports - Jito tip from config (0 = no Jito, dry-run)
 * @param usdPrices - token price map for USD conversion
 */
export function estimateFees(
  jitoTipLamports: bigint,
  usdPrices: UsdPrices
): FeeEstimate {
  const networkFees = NETWORK_FEES_2LEG_LAMPORTS;
  const tip = jitoTipLamports > 0n ? jitoTipLamports : 0n;
  const feeLamports = networkFees + tip;

  const solUsd = usdPrices['SOL'] ?? 0;
  const feeSol = Number(feeLamports) / 1e9;
  const feeUsd = feeSol * solUsd;

  return { feeLamports, feeUsd, includesJitoTip: tip > 0n };
}

// ─── Net profit calculation ────────────────────────────────────────────────────

export interface NetProfitResult {
  /** Gross profit in input-token lamports (before fees) */
  grossProfitLamports: bigint;
  /** Fee cost in input-token lamports (converted from SOL fees) */
  feeInInputLamports: bigint;
  /** Net profit in input-token lamports (may be negative) */
  netProfitLamports: bigint;
  /** Net profit as a % of input amount */
  netProfitPct: number;
  /** Net profit in USD */
  netProfitUsd: number;
  /** Whether the trade is profitable after fees */
  isProfitable: boolean;
}

/**
 * Calculate net profit after deducting Solana tx fees and optional Jito tip.
 *
 * Fees are always paid in SOL. If the input token is not SOL, we convert
 * the SOL fee cost to input-token units using USD prices.
 *
 * @param inputMint          - The arb's starting/ending token mint
 * @param inputSymbol        - Symbol of the input token (e.g. 'SOL', 'USDC')
 * @param inputDecimals      - Decimal places of the input token
 * @param inputAmount        - Trade size in input-token lamports
 * @param outputAmount       - Round-trip return in input-token lamports
 * @param jitoTipLamports    - Jito tip in lamports (0 for dry-run / direct RPC)
 * @param usdPrices          - Current USD price map
 */
export function calcNetProfit(
  inputSymbol: string,
  inputDecimals: number,
  inputAmount: bigint,
  outputAmount: bigint,
  jitoTipLamports: bigint,
  usdPrices: UsdPrices
): NetProfitResult {
  const grossProfitLamports = outputAmount > inputAmount ? outputAmount - inputAmount : 0n;

  // Fee in SOL lamports
  const fees = estimateFees(jitoTipLamports, usdPrices);
  const feeInSolLamports = fees.feeLamports;

  // Convert fee to input-token units
  let feeInInputLamports: bigint;
  if (inputSymbol === 'SOL') {
    feeInInputLamports = feeInSolLamports;
  } else {
    // Convert via USD: fee_usd / input_price_usd → input_token amount
    const inputUsd = usdPrices[inputSymbol] ?? 0;
    if (inputUsd > 0 && fees.feeUsd > 0) {
      const feeInInputHuman = fees.feeUsd / inputUsd;
      feeInInputLamports = BigInt(Math.ceil(feeInInputHuman * 10 ** inputDecimals));
    } else {
      // Can't convert — treat fee as 0 (conservative: may overstate profit)
      feeInInputLamports = 0n;
    }
  }

  const netProfitLamports = grossProfitLamports > feeInInputLamports
    ? grossProfitLamports - feeInInputLamports
    : -feeInInputLamports;

  const netProfitPct = inputAmount > 0n
    ? Number(netProfitLamports) / Number(inputAmount) * 100
    : 0;

  const inputUsd = usdPrices[inputSymbol] ?? 0;
  const netProfitHuman = Number(netProfitLamports) / 10 ** inputDecimals;
  const netProfitUsd = netProfitHuman * inputUsd;

  return {
    grossProfitLamports,
    feeInInputLamports,
    netProfitLamports,
    netProfitPct,
    netProfitUsd,
    isProfitable: netProfitLamports > 0n,
  };
}

/**
 * Minimum required gross profit % to break even after fees, given current SOL price.
 *
 * Useful for logging and diagnostics — e.g. "fee floor is 0.12% at current prices".
 *
 * @param tradeSizeSol - Trade size in SOL
 * @param jitoTipLamports - Jito tip in lamports
 * @param usdPrices - current prices
 */
export function feeFloorPct(
  tradeSizeSol: number,
  jitoTipLamports: bigint,
  usdPrices: UsdPrices
): number {
  const fees = estimateFees(jitoTipLamports, usdPrices);
  const tradeSizeLamports = tradeSizeSol * 1e9;
  if (tradeSizeLamports === 0) return 0;
  return (Number(fees.feeLamports) / tradeSizeLamports) * 100;
}
