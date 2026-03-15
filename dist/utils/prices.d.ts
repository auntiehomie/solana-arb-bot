/**
 * USD price helpers.
 * Primary source: Jupiter price API (free, no key required)
 * Fallback: CoinGecko public API
 */
import { UsdPrices } from '../types';
export declare function setJupiterPriceApiKey(key: string): void;
export declare function getUsdPrices(symbols: string[]): Promise<UsdPrices>;
/** Convert a token amount (in smallest units) to USD */
export declare function toUsd(amountSmallest: bigint, decimals: number, usdPrice: number): number;
//# sourceMappingURL=prices.d.ts.map