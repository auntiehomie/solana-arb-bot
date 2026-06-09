#!/bin/bash
set -euo pipefail
LOG_DIR="./logs"
LOG_FILE="${LOG_DIR}/diagnostic-$(date +%Y%m%d-%H%M%S).log"
mkdir -p "$LOG_DIR"
exec > >(tee -a "$LOG_FILE") 2>&1
echo "=== Solana Arb Bot Diagnostic: $(date) ==="
echo "Node: $(node -v)"
echo "NPM: $(npm -v)"
echo "Branch: $(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'not a git repo')"
echo "Commit: $(git rev-parse --short HEAD 2>/dev/null || echo 'n/a')"
echo ""
echo "=== Typecheck ==="
npx tsc --noEmit 2>&1 || echo "TYPECHECK FAILED"
echo ""
echo "=== TTL config references ==="
grep -Rn "POOL_CACHE_TTL\|PAIR_CACHE_TTL\|CACHE_TTL" src/ || echo "No TTL refs found"
echo ""
echo "=== .env check ==="
if [ -f .env ]; then
  echo ".env exists"
  grep -c "WALLET_PRIVATE_KEY" .env && echo "WALLET_PRIVATE_KEY present" || echo "WALLET_PRIVATE_KEY MISSING"
  grep -c "RPC_URL" .env && echo "RPC_URL present" || echo "RPC_URL MISSING"
else
  echo ".env NOT FOUND — copy from .env.example"
fi
echo ""
echo "=== Build test ==="
npm run build 2>&1 || echo "BUILD FAILED"
echo ""
echo "=== Done. Review: $LOG_FILE ==="