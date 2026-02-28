#!/bin/bash

# Solana Arbitrage Bot Auto-Restart Wrapper

# Pin to the nvm-managed node that sqlite3 was compiled against
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
export PATH="$NVM_DIR/versions/node/v24.13.1/bin:$PATH"

BOT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$BOT_DIR/logs"
PID_FILE="$LOG_DIR/bot.pid"
LOG_FILE="$LOG_DIR/bot.log"

mkdir -p "$LOG_DIR"

# Check if already running
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE")
  if ps -p "$OLD_PID" > /dev/null 2>&1; then
    echo "Bot is already running (PID: $OLD_PID)"
    exit 1
  else
    rm "$PID_FILE"
  fi
fi

# Save current PID
echo $$ > "$PID_FILE"

cd "$BOT_DIR"

echo "🤖 Starting Solana Arbitrage Bot with auto-restart..."
echo "Logs: $LOG_FILE"
echo "PID: $$"
echo ""

# Initialize database if needed
if [ ! -f "$BOT_DIR/data/trading.db" ]; then
  echo "Initializing database..."
  npm run init-db
fi

# Auto-restart loop
while true; do
  echo "[$(date)] Starting bot..." >> "$LOG_FILE"
  
  # Run the bot
  npm start >> "$LOG_FILE" 2>&1
  
  EXIT_CODE=$?
  echo "[$(date)] Bot exited with code $EXIT_CODE" >> "$LOG_FILE"
  
  # If clean exit (SIGINT/SIGTERM), don't restart
  if [ $EXIT_CODE -eq 0 ] || [ $EXIT_CODE -eq 130 ] || [ $EXIT_CODE -eq 143 ]; then
    echo "Clean shutdown detected, not restarting" >> "$LOG_FILE"
    rm "$PID_FILE"
    exit 0
  fi
  
  echo "Restarting in 10 seconds..." >> "$LOG_FILE"
  sleep 10
done
