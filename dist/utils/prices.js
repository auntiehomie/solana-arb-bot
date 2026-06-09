"use strict";
/**
 * USD price helpers.
 * Primary source: Jupiter price API (free, no key required)
 * Fallback: CoinGecko public API
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setJupiterPriceApiKey = setJupiterPriceApiKey;
exports.getUsdPrices = getUsdPrices;
exports.toUsd = toUsd;
const axios_1 = __importDefault(require("axios"));
const logger_1 = require("./logger");
const COINGECKO_IDS = {
    SOL: 'solana',
    JUP: 'jupiter-exchange-solana',
    PENGU: 'pudgy-penguins',
    BONK: 'bonk',
};
// Jupiter Price API v2 (current endpoints as of 2024)
// price.jup.ag is deprecated — use api.jup.ag
const JUPITER_PRICE_URLS = [
    'https://api.jup.ag/price/v2',
    'https://lite-api.jup.ag/v1/prices',
];
const MINT_BY_SYMBOL = {
    SOL: 'So11111111111111111111111111111111111111112',
    JUP: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
    PENGU: '2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv',
    BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
};
let cachedPrices = {};
let lastFetchedAt = 0;
const CACHE_TTL_MS = 120_000; // 2 min — reduces CoinGecko hammering
let _jupiterPriceApiKey = '';
function setJupiterPriceApiKey(key) {
    _jupiterPriceApiKey = key;
}
function jupiterPriceHeaders() {
    return _jupiterPriceApiKey ? { 'x-api-key': _jupiterPriceApiKey } : {};
}
async function getUsdPrices(symbols) {
    const now = Date.now();
    if (now - lastFetchedAt < CACHE_TTL_MS && Object.keys(cachedPrices).length > 0) {
        return cachedPrices;
    }
    // Try Jupiter
    try {
        cachedPrices = await fetchJupiterPrices(symbols);
        lastFetchedAt = now;
        return cachedPrices;
    }
    catch {
        logger_1.logger.debug('Jupiter price fetch failed, trying DexScreener');
    }
    // Try DexScreener (no key, generous limits)
    try {
        cachedPrices = await fetchDexScreenerPrices(symbols);
        lastFetchedAt = now;
        return cachedPrices;
    }
    catch {
        logger_1.logger.debug('DexScreener price fetch failed, trying CoinGecko');
    }
    // Try CoinGecko last (rate-limited)
    try {
        cachedPrices = await fetchCoinGeckoPrices(symbols);
        lastFetchedAt = now;
        return cachedPrices;
    }
    catch (err) {
        logger_1.logger.warn('All price sources failed — using stale/empty prices, profitUsd will be 0');
        return cachedPrices;
    }
}
async function fetchJupiterPrices(symbols) {
    const ids = symbols.map((s) => MINT_BY_SYMBOL[s]).filter(Boolean).join(',');
    let lastErr;
    for (const url of JUPITER_PRICE_URLS) {
        try {
            const resp = await axios_1.default.get(url, {
                params: { ids },
                timeout: 5000,
                headers: jupiterPriceHeaders(),
            });
            const prices = {};
            const data = resp.data?.data ?? {};
            for (const symbol of symbols) {
                const mint = MINT_BY_SYMBOL[symbol];
                if (mint && data[mint]) {
                    prices[symbol] = parseFloat(data[mint].price);
                }
            }
            if (Object.keys(prices).length > 0)
                return prices;
        }
        catch (err) {
            lastErr = err;
            logger_1.logger.debug(`Jupiter price fetch failed at ${url}, trying next`, err);
        }
    }
    throw lastErr ?? new Error('All Jupiter price endpoints failed');
}
async function fetchDexScreenerPrices(symbols) {
    // DexScreener token profiles endpoint — no API key, generous rate limits
    const mints = symbols.map((s) => MINT_BY_SYMBOL[s]).filter(Boolean);
    const prices = {};
    // Fetch in parallel, one request per token (DexScreener doesn't do batch by mint)
    await Promise.allSettled(symbols.map(async (symbol) => {
        const mint = MINT_BY_SYMBOL[symbol];
        if (!mint)
            return;
        const resp = await axios_1.default.get(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, { timeout: 6000 });
        const pair = resp.data?.pairs?.[0];
        if (pair?.priceUsd) {
            prices[symbol] = parseFloat(pair.priceUsd);
        }
    }));
    if (Object.keys(prices).length === 0)
        throw new Error('DexScreener returned no prices');
    return prices;
}
async function fetchCoinGeckoPrices(symbols) {
    const ids = symbols
        .map((s) => COINGECKO_IDS[s])
        .filter(Boolean)
        .join(',');
    const resp = await axios_1.default.get('https://api.coingecko.com/api/v3/simple/price', {
        params: { ids, vs_currencies: 'usd' },
        timeout: 8000,
    });
    const prices = {};
    for (const symbol of symbols) {
        const cgId = COINGECKO_IDS[symbol];
        if (cgId && resp.data[cgId]?.usd) {
            prices[symbol] = resp.data[cgId].usd;
        }
    }
    return prices;
}
/** Convert a token amount (in smallest units) to USD */
function toUsd(amountSmallest, decimals, usdPrice) {
    const humanAmount = Number(amountSmallest) / Math.pow(10, decimals);
    return humanAmount * usdPrice;
}
//# sourceMappingURL=prices.js.map