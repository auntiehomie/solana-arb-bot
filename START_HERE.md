# 🚀 START HERE - Solana Arbitrage Bot

Your Solana arbitrage bot is **ready to run**! This bot monitors prices across Jupiter, Raydium, and Phoenix DEXes, identifies arbitrage opportunities, and simulates trades in paper trading mode.

## ⚡ 2-Minute Quick Start

### Step 1: Get Your API Credentials

**Alchemy RPC (Free):**
1. Visit: https://www.alchemy.com/
2. Sign up (free tier is fine)
3. Create new app → Solana Mainnet
4. Copy your API URL (looks like: `https://solana-mainnet.g.alchemy.com/v2/YOUR_KEY`)

**Discord Webhook:**
1. Open Discord
2. Go to your target channel
3. Click gear icon ⚙️ → Integrations → Webhooks
4. Create New Webhook → Copy URL

### Step 2: Configure the Bot

```bash
cd /root/.openclaw/workspace/solana-arb-bot
cp .env.example .env
nano .env
```

Update these two lines:
```env
SOLANA_RPC_URL=https://solana-mainnet.g.alchemy.com/v2/YOUR_KEY_HERE
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/YOUR_WEBHOOK_HERE
```

Save: `Ctrl+X` → `Y` → `Enter`

### Step 3: Start the Bot

```bash
./run.sh &
```

**That's it!** The bot is now running in the background.

### Step 4: Monitor

**View logs in real-time:**
```bash
tail -f logs/bot.log
```

**Check Discord:** You should see a startup message with bot configuration

**Stop the bot:**
```bash
./stop.sh
```

## 📊 What the Bot Does

1. **Scans prices** from Jupiter, Raydium, Phoenix every 15 minutes
2. **Finds arbitrage opportunities** where you can buy low and sell high
3. **Simulates trades** (no real money, just tracking hypothetical profits)
4. **Logs to Discord:**
   - Startup confirmation
   - Trade summaries when opportunities are found
   - Daily summary at 23:00 UTC
   - Biweekly performance report

## 💰 Paper Trading Details

- **Starting Capital:** $20 USDC (simulated)
- **Position Size:** 20% per trade ($4 maximum)
- **Slippage:** Accounts for 3% price impact
- **Minimum Profit:** 0.5% OR $0.10 (whichever is higher)
- **Safety:** No real trades, no wallet needed

## ⚠️ Important Expectations

**NORMAL BEHAVIOR:**
- Bot may find ZERO opportunities most days
- Real arbitrage on Solana is RARE
- This is expected and the bot is working correctly
- Modern DEXes are very efficient

**The bot is successful if:**
✅ It runs without crashing
✅ It monitors prices correctly
✅ It logs activity to Discord
✅ Database tracks simulated trades

**Don't expect:**
❌ Frequent profitable opportunities
❌ Daily profits (even in paper trading)
❌ Live trading to match paper results

## 📁 Useful Commands

```bash
# Start bot
./run.sh &

# Stop bot
./stop.sh

# View logs
tail -f logs/bot.log

# Check if running
ps aux | grep solana-arb-bot

# View trade history
sqlite3 data/trading.db "SELECT * FROM trades LIMIT 10;"

# Check balance
sqlite3 data/trading.db "SELECT * FROM balance ORDER BY timestamp DESC LIMIT 1;"

# Run tests
npm test
```

## 📚 Documentation

- **README.md** - Complete documentation
- **SETUP.md** - Detailed setup guide
- **LIVE_TRADING_GUIDE.md** - How to go live (NOT recommended)
- **COMPLETION_SUMMARY.md** - Build details

## 🔧 Troubleshooting

**Bot won't start:**
- Check that .env is configured
- Verify Alchemy URL and Discord webhook are correct
- Run `npm install` to ensure dependencies are installed

**No opportunities found:**
- This is NORMAL! Arbitrage is rare
- The bot is working correctly
- Try lowering `MIN_PROFIT_PERCENT` in .env to 0.003 (0.3%) if you want to see more activity

**Discord not receiving messages:**
- Verify webhook URL is correct
- Test: `curl -X POST -H "Content-Type: application/json" -d '{"content":"test"}' YOUR_WEBHOOK_URL`
- Check webhook hasn't been deleted in Discord

**Database errors:**
- Run: `npm run init-db`
- Delete `data/trading.db` and reinitialize

## 🎯 Next Steps After Setup

1. **Let it run for 24 hours** - See if it finds any opportunities
2. **Check Discord** - Review the messages it sends
3. **View database** - Look at trade history (even if empty)
4. **Understand the market** - Learn why arbitrage is rare
5. **Adjust settings** - Experiment with different thresholds
6. **DON'T go live** - Paper trading is for learning only

## ⚡ Optional Tweaks

Edit `.env` to customize:

**Scan more frequently:**
```env
UPDATE_INTERVAL=5  # Check every 5 minutes instead of 15
```

**Lower profit threshold (see more opportunities):**
```env
MIN_PROFIT_PERCENT=0.003  # 0.3% instead of 0.5%
MIN_PROFIT_ABSOLUTE=0.05  # $0.05 instead of $0.10
```

**Monitor different pairs:**
```env
MONITOR_PAIRS=SOL/USDC,USDT/USDC,RAY/SOL,BONK/SOL
```

**Increase starting capital:**
```env
STARTING_CAPITAL=100  # $100 instead of $20
```

## 🆘 Need Help?

1. Check logs first: `tail -100 logs/bot.log`
2. Review Discord messages for clues
3. Read README.md for detailed explanations
4. Verify .env configuration
5. Run tests: `npm test`

## 🎓 What You're Learning

This bot teaches:
- How Solana DEXes work (Jupiter, Raydium, Phoenix)
- Arbitrage detection algorithms
- Why retail arbitrage is challenging
- Risk management (slippage, position sizing)
- Bot architecture (event loops, databases, APIs)

**Most important lesson:** Arbitrage profits in crypto marketing/theory don't reflect reality. Modern DEXes are extremely efficient, and retail bots can't compete with professional MEV operations.

## 🎉 You're Ready!

The bot is configured and ready to start monitoring Solana markets. Run `./run.sh &` and watch your Discord channel!

---

**Questions?** Check README.md or SETUP.md for more details.

**Good luck!** 🚀📈
