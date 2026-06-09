/**
 * DEXes known to return phantom/incorrect quotes on Jupiter's routing API.
 * These are typically thin-liquidity or experimental venues where the price
 * feed doesn't reflect real executable liquidity.
 *
 * Any route containing one of these labels is rejected before execution.
 * Add new entries here as they're discovered in logs.
 */
export const EXOTIC_DEX_BLOCKLIST = [
  'Stabble',     // phantom quotes, near-zero liquidity
  'ZeroFi',      // exotic, bad price feeds
  'Aquifer',     // thin liquidity, incorrect quotes
  'HumidiFi',    // bad price data observed in production
  'Bonkswap',    // meme DEX, unreliable quotes
  'GoonFi',      // thin liquidity, seen in logs
  'BisonFi',     // thin liquidity, unverified
  'AlphaQ',      // thin liquidity, unverified
  'Scorch',      // unverified, thin
  '1DEX',        // thin orderbook, unreliable for arb
  'Invariant',   // low liquidity, exotic pricing
  'GooseFX',     // thin liquidity
  'Obric',       // oracle-based, not AMM — quotes unreliable for arb
  'Perps',       // perpetuals venue, not spot
  'TesseraV',    // exotic, bad prices observed in production
  'PancakeSwap', // Solana fork has thin liquidity
  'Manifest',    // CLOB orderbook — stale quotes cause leg 2 timeouts
  'Omnipair',    // exotic, thin liquidity
  'Quantum',     // exotic, thin liquidity
  'FluxBeam',    // thin liquidity
  'Dooar',       // thin liquidity
];

export function routeHasExoticDex(route: string): boolean {
  return EXOTIC_DEX_BLOCKLIST.some(dex => route.includes(dex));
}
