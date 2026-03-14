# Solana Arbitrage Bot 🤖

A production-ready Solana arbitrage bot that monitors price discrepancies across **Raydium**, **Orca**, **Jupiter**, and **Meteora** for the tokens **$JUP**, **$PENGU**, **$BONK**, and **SOL** — executing profitable trades via **Jito bundles**.

---

## ⚠️ Risk Warning

> **USE AT YOUR OWN RISK.** Arbitrage bots operate in an adversarial environment. You can and will lose money if:
> - Prices change between detection and execution (slippage)
> - Network congestion causes transactions to fail
> - Your bot has bugs or is misconfigured
> - You run with insufficient SOL for fees
>
> **Always start with `DRY_RUN=true` and verify the bot's behaviour before enabling live trading.**

---

## Features

- 📡 **Multi-DEX monitoring** — Jupiter, Raydium, Orca, Meteora in parallel
- 💰 **Smart opportunity detection** — profit threshold by % and USD
- 🚀 **Jito bundle execution** — atomic 3-tx bundles with tip scaling
- 🧪 **Dry-run mode** — simulate without spending real SOL
- 🛡️ **Safety rails** — balance checks, rate limiting, slippage protection
- 📊 **Structured logging** — coloured, timestamped, BigInt-safe

---

## Token Pairs Monitored

| Pair      | Direction           |
|-----------|---------------------|
| JUP/SOL   | Buy JUP sell SOL ↔  |
| PENGU/SOL | Buy PENGU sell SOL ↔|
| BONK/SOL  | Buy BONK sell SOL ↔ |
| JUP/BONK  | Triangular via SOL  |

---

## Prerequisites

- **Node.js** ≥ 18
- A Solana wallet with SOL (recommend 0.5+ SOL to start)
- A private RPC endpoint (recommended: [Helius](https://helius.dev), [Triton](https://triton.one), [QuickNode](https://quicknode.com))
- A Jito UUID (optional for dry-run, required for live trading)

---

## Installation

```bash
# Clone or copy the project
cd solana-arb-bot

# Install dependencies
npm install

# Copy env template
cp .env.example .env

# Edit .env with your settings
nano .env
```

---

## Configuration

Edit `.env` (copy from `.env.example`):

| Variable | Default | Description |
|---|---|---|
| `RPC_URL` | mainnet-beta | Solana RPC HTTP endpoint |
| `RPC_WS_URL` | mainnet-beta | Solana RPC WebSocket endpoint |
| `WALLET_PRIVATE_KEY` | — | Base58 private key (required) |
| `JITO_UUID` | — | Jito block engine UUID |
| `JITO_TIP_LAMPORTS` | 10000 | Minimum Jito tip (lamports) |
| `MIN_PROFIT_PCT` | 1.0 | Minimum profit % to flag |
| `MIN_PROFIT_USD` | 0.50 | Minimum profit USD to flag |
| `TRADE_SIZE_SOL` | 0.1 | Trade size in SOL equivalent |
| `MAX_SLIPPAGE_BPS` | 50 | Max slippage (50 = 0.5%) |
| `SCAN_INTERVAL_MS` | 1000 | Scan frequency in ms |
| `DRY_RUN` | **true** | Simulate without executing |
| `MAX_TRADES_PER_MINUTE` | 5 | Rate limit for live trades |
| `LOG_LEVEL` | INFO | DEBUG / INFO / WARN / ERROR |

---

## Getting a Jito UUID

1. Go to [https://jito.network](https://jito.network)
2. Connect your wallet
3. Generate a UUID under "Block Engine Access"
4. Set `JITO_UUID=your-uuid-here` in `.env`

The UUID is used as a Bearer token in the `Authorization` header when submitting bundles. Without it you can still submit bundles (unauthenticated), but with lower priority.

---

## Running

### Development (ts-node, hot-reload off)
```bash
npm run dev
```

### Development (watch mode)
```bash
npm run dev:watch
```

### Production (compiled)
```bash
npm run build
npm start
```

### Type-check only
```bash
npm run typecheck
```

---

## Recommended First-Run Checklist

1. ✅ Set `DRY_RUN=true`
2. ✅ Set a real `WALLET_PRIVATE_KEY` (read-only or burner wallet)
3. ✅ Set a private `RPC_URL` (public RPC will rate-limit you)
4. ✅ Start with `TRADE_SIZE_SOL=0.05` (small trades)
5. ✅ Watch the logs for a few minutes
6. ✅ Verify opportunity detection makes sense
7. ✅ Check profit calculations match expectations
8. ⚠️ Only then set `DRY_RUN=false`

---

## Architecture

```
src/
├── index.ts              — Main loop, orchestration
├── config.ts             — .env loader + validation
├── types.ts              — TypeScript interfaces
├── monitor/
│   ├── jupiter.ts        — Jupiter v6 quote API
│   ├── raydium.ts        — Raydium CLMM pools + Jupiter fallback
│   ├── orca.ts           — Orca Whirlpool pools + Jupiter fallback
│   └── meteora.ts        — Meteora DLMM pairs + Jupiter fallback
├── scanner/
│   └── opportunities.ts  — Cross-DEX opportunity detection
├── executor/
│   ├── builder.ts        — Jupiter swap tx builder, balance checks
│   └── jito.ts           — Jito bundle submission
└── utils/
    ├── logger.ts         — Coloured structured logger
    └── prices.ts         — USD prices (Jupiter → CoinGecko fallback)
```

### Opportunity Detection Flow

```
For each pair (JUP/SOL, PENGU/SOL, BONK/SOL, JUP/BONK):
  1. Fetch buy quote from all 4 DEXes in parallel
  2. For each (buyDex, sellDex) combination:
     a. Simulate: spend X on buyDex → get Y tokens
     b. Simulate: sell Y tokens on sellDex → get Z back
     c. Profit = Z - X
     d. Flag if profit% >= MIN_PROFIT_PCT OR profitUSD >= MIN_PROFIT_USD
  3. Sort by USD profit descending
  4. Deduplicate per pair (keep best only)
```

### Jito Bundle Structure

```
Bundle = [
  tx1: swap leg 1  (buy on cheapest DEX via Jupiter)
  tx2: swap leg 2  (sell on most expensive DEX via Jupiter)
  tx3: tip payment (to Jito tip account)
]
```

Tip = `max(JITO_TIP_LAMPORTS, 1% of expected profit in lamports)`

---

## Safety Features

| Feature | Implementation |
|---|---|
| Dry-run mode | Default `true` — skips all execution |
| Min SOL reserve | Keeps 0.05 SOL for fees at all times |
| Rate limiter | Sliding window, max N trades/minute |
| Slippage protection | `MAX_SLIPPAGE_BPS` passed to Jupiter |
| DEX fault isolation | Each DEX fails independently |
| Exponential backoff | On 429 rate-limit responses |
| BigInt lamport math | No floating-point rounding errors |

---

## Limitations & Caveats

- **Pool-price vs. simulated-price gap**: Raydium/Orca/Meteora direct API prices don't account for price impact on your specific trade size. For large trades, actual output may be lower.
- **Staleness**: Pool price caches are 60 s. Actual on-chain prices may differ.
- **MEV competition**: Real arbitrage opportunities are competed for by professional MEV bots. You may win bundles rarely.
- **RPC rate limits**: Public RPC endpoints will throttle you. Use a private endpoint.
- **Jupiter fallback**: Some per-DEX quotes route through Jupiter with `onlyDirectRoutes=true`. If Jupiter doesn't have the DEX indexed, the quote is omitted.

---

## Disclaimer

This software is provided **as-is** for educational purposes. The authors are not responsible for financial losses. Crypto trading is risky. DeFi is risky. Arbitrage bots are not guaranteed profitable. Always understand what you're running.
