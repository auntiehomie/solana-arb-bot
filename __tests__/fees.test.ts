/**
 * Unit tests for src/utils/fees.ts — fee modeling and net profit calculation.
 */

// Mocks must be at top level
jest.mock('../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  estimateFees,
  calcNetProfit,
  feeFloorPct,
  NETWORK_FEES_2LEG_LAMPORTS,
  COMPETITIVE_JITO_TIP_LAMPORTS,
} from '../src/utils/fees';
import { UsdPrices } from '../src/types';

const SOL_100: UsdPrices = { SOL: 100, USDC: 1 };
const SOL_150: UsdPrices = { SOL: 150, USDC: 1, JUP: 0.5 };

describe('estimateFees', () => {
  test('returns base network fees with no Jito tip', () => {
    const result = estimateFees(0n, SOL_150);
    expect(result.feeLamports).toBe(NETWORK_FEES_2LEG_LAMPORTS);  // 60_000
    expect(result.includesJitoTip).toBe(false);
    expect(result.feeUsd).toBeCloseTo((Number(NETWORK_FEES_2LEG_LAMPORTS) / 1e9) * 150, 4);
  });

  test('includes Jito tip when provided', () => {
    const tip = COMPETITIVE_JITO_TIP_LAMPORTS;  // 50_000
    const result = estimateFees(tip, SOL_150);
    expect(result.feeLamports).toBe(NETWORK_FEES_2LEG_LAMPORTS + tip);
    expect(result.includesJitoTip).toBe(true);
  });

  test('handles zero SOL price gracefully', () => {
    const prices: UsdPrices = { SOL: 0, USDC: 1 };
    const result = estimateFees(0n, prices);
    expect(result.feeUsd).toBe(0);
  });
});

describe('calcNetProfit', () => {
  const DECIMALS = 9;       // SOL
  const INPUT_LAMPORTS = 100_000_000n;  // 0.1 SOL
  const PROFITABLE_OUTPUT = 100_100_000n;  // 0.1% gross profit = 100k lamports (exceeds 60k fee floor)

  test('returns profitable result for positive net', () => {
    const result = calcNetProfit('SOL', DECIMALS, INPUT_LAMPORTS, PROFITABLE_OUTPUT, 0n, SOL_150);
    expect(result.grossProfitLamports).toBe(100_000n);
    expect(result.isProfitable).toBe(true);
    expect(result.netProfitPct).toBeGreaterThan(0);
    expect(result.netProfitUsd).toBeGreaterThan(0);
  });

  test('returns non-profitable when fees exceed gross profit', () => {
    // Gross profit = 10 lamports, fees > that
    const tinyProfit = INPUT_LAMPORTS + 10n;
    const result = calcNetProfit('SOL', DECIMALS, INPUT_LAMPORTS, tinyProfit, 0n, SOL_100);
    // Fees are 60_000 lamports net, gross is 10 → net is negative
    expect(result.grossProfitLamports).toBe(10n);
    expect(result.isProfitable).toBe(false);
    expect(result.netProfitLamports).toBeLessThanOrEqual(0n);
  });

  test('handles zero profit gracefully', () => {
    const result = calcNetProfit('SOL', DECIMALS, INPUT_LAMPORTS, INPUT_LAMPORTS, 0n, SOL_150);
    expect(result.grossProfitLamports).toBe(0n);
    expect(result.isProfitable).toBe(false);
  });

  test('handles negative profit (loss-making trade)', () => {
    const lossOutput = INPUT_LAMPORTS - 1_000_000n;  // less than input
    const result = calcNetProfit('SOL', DECIMALS, INPUT_LAMPORTS, lossOutput, 0n, SOL_150);
    expect(result.grossProfitLamports).toBe(0n);
    expect(result.netProfitPct).toBeLessThan(0);
    expect(result.isProfitable).toBe(false);
  });

  test('converts fees from SOL to non-SOL input tokens', () => {
    // USDC has 6 decimals
    const usdcDecimals = 6;
    const usdcInput = 10_000_000n;  // 10 USDC
    const usdcOutput = 10_005_000n; // 10.005 USDC (0.05% gross)

    const result = calcNetProfit('USDC', usdcDecimals, usdcInput, usdcOutput, 0n, SOL_150);
    // Fee in SOL lamports is 60_000, at $150/SOL = $0.009
    // USD fee / USDC price ($1) = 0.009 USDC in fee → 9000 lamports at 6 decimals
    expect(result.grossProfitLamports).toBe(5_000n);
    expect(result.isProfitable).toBe(false);  // 5000 gross < 9000 fee
  });

  test('incorporates Jito tip in profitability check', () => {
    // Without Jito: gross 100k lamports, fees 60k → profitable
    const noJito = calcNetProfit('SOL', DECIMALS, INPUT_LAMPORTS, PROFITABLE_OUTPUT, 0n, SOL_150);
    expect(noJito.isProfitable).toBe(true);

    // With 100k tip: fees = 60k + 100k = 160k > 100k gross → not profitable
    const withTip = calcNetProfit('SOL', DECIMALS, INPUT_LAMPORTS, PROFITABLE_OUTPUT, 100_000n, SOL_150);
    expect(withTip.netProfitLamports).toBeLessThan(noJito.netProfitLamports);
    expect(withTip.isProfitable).toBe(false);
  });

  test('edge: large trade where profit exceeds fees', () => {
    const largeInput = 10_000_000_000n;  // 10 SOL
    const largeOutput = 10_001_000_000n; // 0.01% gross profit = 1_000_000 lamports
    const result = calcNetProfit('SOL', DECIMALS, largeInput, largeOutput, 0n, SOL_150);
    expect(result.grossProfitLamports).toBe(1_000_000n);
    expect(result.isProfitable).toBe(true);
    expect(result.netProfitPct).toBeGreaterThan(0);
  });

  test('edge: unknown token price defaults to zero conversion', () => {
    const prices: UsdPrices = { SOL: 150 };  // no USDC price
    const result = calcNetProfit('USDC', 6, 10_000_000n, 10_005_000n, 0n, prices);
    expect(result.feeInInputLamports).toBe(0n);  // can't convert, treats fee as 0
    expect(result.isProfitable).toBe(true);      // optimistic: no fees
  });

  test('edge: zero input amount', () => {
    // Zero input means no trade — can't have profit from nothing
    const result = calcNetProfit('SOL', DECIMALS, 0n, 100n, 0n, SOL_150);
    expect(result.grossProfitLamports).toBe(100n);
    expect(result.netProfitPct).toBe(0);  // input=0 → no percentage calculation
    expect(result.isProfitable).toBe(false);
    expect(result.netProfitLamports).toBeLessThan(0n);  // net is still negative due to fees
  });
});

describe('feeFloorPct', () => {
  test('returns correct percentage for a trade size', () => {
    // 60_000 lamports / 0.1 SOL = 60_000 / 100_000_000 = 0.06%
    const floor = feeFloorPct(0.1, 0n, SOL_150);
    expect(floor).toBeCloseTo(0.06, 2);
  });

  test('scales with Jito tip', () => {
    const noTip = feeFloorPct(0.1, 0n, SOL_150);
    const withTip = feeFloorPct(0.1, COMPETITIVE_JITO_TIP_LAMPORTS, SOL_150);
    expect(withTip).toBeGreaterThan(noTip);
  });

  test('smaller trades have higher fee floor %', () => {
    const small = feeFloorPct(0.05, 0n, SOL_150);
    const large = feeFloorPct(1.0, 0n, SOL_150);
    expect(small).toBeGreaterThan(large);  // fees as % of trade = higher for small trades
  });
});