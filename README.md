# Solana Arbitrage Bot - Paper Trading

A fully functional Solana arbitrage bot that monitors prices across multiple DEXes (Jupiter, Raydium, Phoenix) and executes **simulated paper trades** to test strategies before going live.

## Features

- 📊 **Multi-DEX Price Monitoring**: Jupiter (primary), Raydium, Phoenix (optional)
- 📝 **Paper Trading Mode**: Simulate trades without risking real funds
- 💬 **Discord Integration**: Real-time notifications via webhook
- 💾 **SQLite Database**: Complete trade history and P&L tracking
- 📈 **Automated Reporting**: Daily summaries and biweekly performance reports
- 🔄 **Auto-Restart**: Keeps running with automatic crash recovery
- ⚡ **Rate Limited**: Batches updates to avoid spam and API limits

## Quick Start

### 1. Installation

```bash
cd /root/.openclaw/workspace/solana-arb-bot
npm install
```

### 2. Configuration

Copy the example environment file and configure:

```bash
cp .env.example .env
nano .env
```

**Required configuration:**

```env
# Get your Alchemy API key from: https://www.alchemy.com/
SOLANA_RPC_URL=https://solana-mainnet.g.alchemy.com/v2/YOUR_API_KEY

# Get webhook URL from Discord channel settings
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/YOUR_WEBHOOK_URL
```

**Optional configuration:**

- `STARTING_CAPITAL`: Initial paper trading balance (default: 20)
- `SLIPPAGE_TOLERANCE`: Max slippage percentage (default: 0.03 = 3%)
- `MIN_PROFIT_PERCENT`: Minimum profit threshold (default: 0.005 = 0.5%)
- `MIN_PROFIT_ABSOLUTE`: Minimum dollar profit (default: 0.10)
- `UPDATE_INTERVAL`: Scan frequency in minutes (default: 15)
- `MONITOR_PAIRS`: Token pairs to watch (default: SOL/USDC,RAY/USDC,BONK/USDC)

### 3. Initialize Database

```bash
npm run init-db
```

### 4. Run the Bot

**Option A: Direct run (foreground)**
```bash
npm start
```

**Option B: Auto-restart wrapper (recommended)**
```bash
chmod +x run.sh stop.sh
./run.sh &
```

**Option C: Background with nohup**
```bash
nohup ./run.sh > /dev/null 2>&1 &
```

### 5. Stop the Bot

```bash
./stop.sh
```

Or press `Ctrl+C` if running in foreground.

## Discord Notifications

The bot sends the following notifications:

1. **Startup Confirmation**: Bot configuration and status
2. **Trade Summaries**: Details of each simulated trade executed
3. **Daily Summary** (23:00 UTC): Day's trading performance
4. **Biweekly Report** (Every 14 days): Detailed P&L analysis

### Setting Up Discord Webhook

1. Go to your Discord server
2. Select the channel for notifications
3. Click the gear icon → Integrations → Webhooks
4. Create New Webhook
5. Copy the Webhook URL
6. Paste it into `.env` as `DISCORD_WEBHOOK_URL`

## Paper Trading Logic

The bot simulates trades with the following logic:

- **Position Sizing**: Uses 20% of available balance per trade
- **Slippage Modeling**: Accounts for 3% slippage (configurable)
- **Profit Thresholds**: Only trades if profit exceeds 0.5% OR $0.10
- **Balance Tracking**: Updates hypothetical balance after each trade
- **Gas Estimation**: Minimum absolute profit accounts for gas costs

**No real trades are executed. No wallet private key is needed.**

## Database Schema

### `trades` Table
Stores all executed (simulated) trades:
- Trade details (pair, exchanges, prices, amounts)
- Profit calculations
- Execution status and notes

### `balance` Table
Tracks account balance over time:
- Current balance
- Total trades and wins
- Cumulative profit

### `opportunities` Table
Logs all detected arbitrage opportunities:
- Whether opportunity was taken
- Price spreads across exchanges

## Switching to Live Trading

⚠️ **USE AT YOUR OWN RISK** ⚠️

To enable live trading (NOT RECOMMENDED without thorough testing):

1. **Add Solana Wallet**:
   ```env
   PAPER_MODE=false
   SOLANA_PRIVATE_KEY=your_base58_private_key_here
   ```

2. **Implement Live Execution**:
   - Modify `src/trader.js` to use `@solana/web3.js` for real transactions
   - Add transaction signing and submission logic
   - Implement proper error handling and retries
   - Add transaction confirmation waiting

3. **Required Changes**:
   - Replace `simulateTrade()` with actual Jupiter swap calls
   - Add wallet management and security
   - Implement proper slippage protection
   - Add transaction fee calculations
   - Handle failed transactions

4. **Testing**:
   - Start with SMALL amounts on devnet
   - Monitor closely for the first 24 hours
   - Verify all trades in blockchain explorer

## Project Structure

```
solana-arb-bot/
├── src/
│   ├── index.js           # Main bot entry point
│   ├── config.js          # Configuration loader
│   ├── arbitrage.js       # Opportunity detection
│   ├── trader.js          # Paper trading logic
│   ├── discord.js         # Discord notifications
│   ├── scheduler.js       # Scheduled reports
│   ├── db/
│   │   ├── init.js        # Database setup
│   │   └── queries.js     # Database queries
│   └── dex/
│       ├── jupiter.js     # Jupiter price API
│       ├── raydium.js     # Raydium price API
│       └── phoenix.js     # Phoenix (placeholder)
├── data/
│   └── trading.db         # SQLite database
├── logs/
│   └── bot.log            # Bot logs
├── package.json
├── .env                   # Your configuration
├── .env.example           # Example configuration
├── run.sh                 # Auto-restart wrapper
├── stop.sh                # Stop script
└── README.md              # This file
```

## Monitoring

**View logs:**
```bash
tail -f logs/bot.log
```

**Check if running:**
```bash
ps aux | grep "node.*solana-arb-bot"
```

**Database queries:**
```bash
sqlite3 data/trading.db "SELECT * FROM trades ORDER BY timestamp DESC LIMIT 10;"
sqlite3 data/trading.db "SELECT * FROM balance ORDER BY timestamp DESC LIMIT 1;"
```

## Troubleshooting

**Bot not finding opportunities:**
- Arbitrage is rare with current DEX efficiency
- Try adjusting `MIN_PROFIT_PERCENT` lower (e.g., 0.003 = 0.3%)
- Add more token pairs to `MONITOR_PAIRS`
- Check that RPC endpoint is working

**Discord notifications not working:**
- Verify webhook URL is correct
- Check channel permissions
- Look for errors in logs

**High CPU usage:**
- Increase `UPDATE_INTERVAL` (e.g., 30 minutes)
- Reduce number of `MONITOR_PAIRS`

**Database locked errors:**
- Stop the bot before running manual queries
- Database uses WAL mode for better concurrency

## Performance Notes

- **API Rate Limits**: Respects DEX API limits with delays between requests
- **Update Frequency**: Default 15 minutes balances accuracy vs. spam
- **Opportunity Detection**: Compares all exchange pairs for each token
- **Position Sizing**: Conservative 20% per trade to allow multiple concurrent opportunities

## Security

- ✅ No private keys needed for paper trading
- ✅ No real transactions executed
- ✅ Read-only access to DEX price APIs
- ✅ Local SQLite database (no external DB)
- ⚠️ Discord webhook URL in .env (keep secure)

## Future Enhancements

- [ ] Phoenix DEX integration (requires on-chain SDK)
- [ ] More token pairs and cross-pair arbitrage
- [ ] MEV protection for live trading
- [ ] Backtesting mode with historical data
- [ ] Web dashboard for monitoring
- [ ] Mobile notifications (Telegram/SMS)
- [ ] Machine learning for opportunity prediction

## License

MIT

## Disclaimer

This software is provided as-is for educational and testing purposes. Paper trading results do not guarantee real trading performance. Use live trading at your own risk. The authors are not responsible for any financial losses.

---

**Need help?** Check logs first, then Discord notifications for clues. For live trading questions, consult Solana and Jupiter documentation.
