# Setup Guide - Solana Arbitrage Bot

## Quick Setup (5 minutes)

### Step 1: Get Alchemy API Key

1. Go to https://www.alchemy.com/
2. Sign up for a free account
3. Create a new app:
   - Chain: Solana
   - Network: Mainnet
4. Copy your API key

### Step 2: Get Discord Webhook

1. Open Discord and go to the target channel (ID: 1472981459555057749)
2. Click the gear icon ⚙️ next to the channel name
3. Go to **Integrations** → **Webhooks**
4. Click **New Webhook**
5. Name it "Solana Arb Bot"
6. Copy the Webhook URL

### Step 3: Configure Environment

```bash
cd /root/.openclaw/workspace/solana-arb-bot
cp .env.example .env
nano .env
```

Update these two lines:
```env
SOLANA_RPC_URL=https://solana-mainnet.g.alchemy.com/v2/YOUR_ALCHEMY_API_KEY
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/YOUR_WEBHOOK_URL
```

Save and exit (Ctrl+X, Y, Enter)

### Step 4: Run the Bot

```bash
./run.sh &
```

The bot will:
- ✅ Start monitoring SOL/USDC, RAY/USDC, BONK/USDC
- ✅ Check for arbitrage opportunities every 15 minutes
- ✅ Execute paper trades automatically
- ✅ Send notifications to Discord
- ✅ Auto-restart if it crashes

### Step 5: Monitor

**View logs:**
```bash
tail -f logs/bot.log
```

**Check Discord:** You should see a startup message with bot configuration

**Stop the bot:**
```bash
./stop.sh
```

## Configuration Options

Edit `.env` to customize:

| Variable | Default | Description |
|----------|---------|-------------|
| `STARTING_CAPITAL` | 20 | Starting balance in USDC (paper) |
| `SLIPPAGE_TOLERANCE` | 0.03 | Max slippage (3%) |
| `MIN_PROFIT_PERCENT` | 0.005 | Minimum 0.5% profit |
| `MIN_PROFIT_ABSOLUTE` | 0.10 | Minimum $0.10 profit per trade |
| `UPDATE_INTERVAL` | 15 | Scan frequency (minutes) |
| `MONITOR_PAIRS` | SOL/USDC,RAY/USDC,BONK/USDC | Pairs to monitor |

## Understanding Paper Trading

**What happens:**
- Bot monitors real DEX prices
- Detects arbitrage opportunities
- Simulates trades without executing
- Tracks hypothetical P&L in database

**Position sizing:**
- Uses 20% of available balance per trade
- Accounts for 3% slippage
- Only trades if profit > 0.5% AND > $0.10

**Example:**
```
Starting balance: $20
Trade amount: $4 (20% of $20)
Opportunity: Buy SOL on Jupiter @ $100, Sell on Raydium @ $105 (5% spread)

After slippage:
- Buy: $100 * 1.03 = $103
- Sell: $105 * 0.97 = $101.85
- Profit: ($101.85 - $103) / $103 = -1.1% ❌

Would NOT trade (negative after slippage)
```

## Discord Notifications

The bot sends:

1. **On startup** - Configuration summary
2. **On each trade** - Trade details, profit, running balance
3. **Daily at 23:00 UTC** - Daily summary
4. **Every 14 days** - Biweekly performance report

## Database

View trade history:
```bash
sqlite3 data/trading.db "SELECT * FROM trades ORDER BY timestamp DESC LIMIT 10;"
```

Current balance:
```bash
sqlite3 data/trading.db "SELECT * FROM balance ORDER BY timestamp DESC LIMIT 1;"
```

## Troubleshooting

### "No opportunities found"
- **Normal!** Arbitrage is rare with efficient DEXes
- Try lowering `MIN_PROFIT_PERCENT` to 0.003 (0.3%)
- Current markets may not have arbitrage opportunities
- The bot is working correctly even if it finds nothing

### "Discord webhook not configured"
- Make sure you pasted the full webhook URL
- Test with: `curl -X POST -H "Content-Type: application/json" -d '{"content":"Test"}' YOUR_WEBHOOK_URL`

### "API rate limit"
- Increase `UPDATE_INTERVAL` to 30 minutes
- Reduce number of `MONITOR_PAIRS`

### Bot keeps restarting
- Check logs: `tail -100 logs/bot.log`
- Verify Alchemy API key is valid
- Make sure RPC URL is correct

## Going Live (NOT RECOMMENDED)

⚠️ **Paper trading is recommended.** If you want to test live:

1. Start with $5-10 on devnet first
2. Add private key to `.env`:
   ```env
   PAPER_MODE=false
   SOLANA_PRIVATE_KEY=your_base58_private_key
   ```
3. Implement transaction logic in `src/trader.js`
4. Add Jupiter swap integration
5. Test thoroughly on devnet
6. Monitor closely for 24+ hours

**Reality check:** 
- Gas fees eat into small profits
- Slippage is often worse than estimated
- MEV bots are faster
- You may lose money even if paper trading showed profit

## Support

- Logs: `tail -f logs/bot.log`
- Discord: Check bot messages
- Database: `sqlite3 data/trading.db`
- Test: `npm test`

## Architecture

```
Bot Flow:
1. Scan DEXes (Jupiter, Raydium) every 15 min
2. Compare prices across exchanges
3. Calculate profit after slippage
4. If profitable: simulate trade, update balance
5. Record in database
6. Send Discord notification
7. Repeat
```

Files:
- `src/index.js` - Main loop
- `src/arbitrage.js` - Opportunity detection
- `src/trader.js` - Paper trading logic
- `src/discord.js` - Notifications
- `src/dex/` - DEX price fetchers
- `data/trading.db` - Trade history

Enjoy your paper trading! 🚀
