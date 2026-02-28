#!/bin/bash

BOT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$BOT_DIR/logs/bot.pid"

# Kill any running node src/index.js processes for this bot (handles orphaned children)
pkill -f "node src/index.js" 2>/dev/null

if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if ps -p "$PID" > /dev/null 2>&1; then
    echo "Stopping bot (PID: $PID)..."
    kill -TERM "$PID" 2>/dev/null
    sleep 2
    kill -KILL "$PID" 2>/dev/null
  fi
  rm -f "$PID_FILE"
fi

echo "Bot stopped successfully"
