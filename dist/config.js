"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadConfig = loadConfig;
exports.validateConfig = validateConfig;
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
dotenv_1.default.config({ path: path_1.default.resolve(process.cwd(), '.env') });
function requireEnv(key) {
    const val = process.env[key];
    if (!val) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return val;
}
function optionalEnv(key, fallback) {
    return process.env[key] ?? fallback;
}
function parseFloat_(key, fallback) {
    const raw = process.env[key];
    if (!raw)
        return fallback;
    const val = parseFloat(raw);
    if (isNaN(val))
        throw new Error(`Invalid float for ${key}: ${raw}`);
    return val;
}
function parseInt_(key, fallback) {
    const raw = process.env[key];
    if (!raw)
        return fallback;
    const val = parseInt(raw, 10);
    if (isNaN(val))
        throw new Error(`Invalid integer for ${key}: ${raw}`);
    return val;
}
function parseBool(key, fallback) {
    const raw = process.env[key];
    if (!raw)
        return fallback;
    return raw.toLowerCase() === 'true' || raw === '1';
}
let _config = null;
function loadConfig() {
    if (_config)
        return _config;
    _config = {
        rpcUrl: optionalEnv('RPC_URL', 'https://api.mainnet-beta.solana.com'),
        rpcWsUrl: optionalEnv('RPC_WS_URL', 'wss://api.mainnet-beta.solana.com'),
        walletPrivateKey: requireEnv('WALLET_PRIVATE_KEY'),
        jitoUuid: optionalEnv('JITO_UUID', ''),
        jitoEndpoint: 'https://mainnet.block-engine.jito.wtf/api/v1/bundles',
        jupiterApiKey: optionalEnv('JUPITER_API_KEY', ''),
        jitoTipAccount: '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
        jitoTipLamports: BigInt(parseInt_(('JITO_TIP_LAMPORTS'), 10000)),
        minProfitPct: parseFloat_('MIN_PROFIT_PCT', 1.0),
        minProfitUsd: parseFloat_('MIN_PROFIT_USD', 0.50),
        tradeSizeSol: parseFloat_('TRADE_SIZE_SOL', 0.1),
        maxSlippageBps: parseInt_('MAX_SLIPPAGE_BPS', 50),
        scanIntervalMs: parseInt_('SCAN_INTERVAL_MS', 1000),
        dryRun: parseBool('DRY_RUN', true),
        maxTradesPerMinute: parseInt_('MAX_TRADES_PER_MINUTE', 5),
        raydiumMinIntervalMs: parseInt_('RAYDIUM_MIN_INTERVAL_MS', 500),
        startingCapitalUsd: parseFloat_('STARTING_CAPITAL_USD', 15),
        tradeSizes: (process.env.TRADE_SIZES || '0.1').split(',').map(s => parseFloat(s)).filter(n => !isNaN(n) && n > 0),
    };
    return _config;
}
function validateConfig(cfg) {
    if (!cfg.walletPrivateKey)
        throw new Error('WALLET_PRIVATE_KEY is required');
    if (cfg.tradeSizeSol <= 0)
        throw new Error('TRADE_SIZE_SOL must be positive');
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
//# sourceMappingURL=config.js.map