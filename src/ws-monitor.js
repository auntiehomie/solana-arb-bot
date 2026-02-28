/**
 * ws-monitor.js
 *
 * Subscribes to on-chain logs for Raydium / Orca / Meteora via Alchemy WebSocket.
 * Fires onSwapDetected() within ~150 ms of a real swap, replacing the 45-second
 * DexScreener polling loop.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { config } from './config.js';

const DEX_PROGRAMS = {
  'Raydium AMM':  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  'Raydium CLMM': 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
  'Orca':         'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
  'Meteora':      'LBUZKhRxPF3XUpBCjp4YzTKgLLjzvpoVWWoEUH9Q64J',
};

// After a swap event arrives, wait this long before triggering a scan.
// Batches multiple rapid-fire log events into one scan.
const DEBOUNCE_MS = 150;

// Never scan faster than this regardless of event volume.
// 4 tokens × 3 DEXes = 12 Jupiter API calls per scan; keep it sane.
const MIN_SCAN_INTERVAL_MS = 8000;

export class WSMonitor {
  constructor(onSwapDetected) {
    this.onSwapDetected    = onSwapDetected;
    this.connection        = null;
    this.subscriptionIds   = [];
    this.debounceTimer     = null;
    this.lastScanAt        = 0;
    this.swapEventCount    = 0;
    this.triggeredScans    = 0;
    this.running           = false;
    this.reconnectAttempts = 0;
  }

  async start() {
    // Helius is required for WebSocket — Alchemy free tier blocks all subscriptions
    if (!config.heliusRpcUrl) {
      console.log(`⚠️  WS Monitor: No HELIUS_RPC_URL set — running in poll-only mode`);
      console.log(`   Add your Helius key to .env to enable real-time swap detection`);
      console.log(`   Get a free key at https://helius.dev\n`);
      this.running = false;
      return; // fallback polling in index.js will handle scans
    }

    const httpUrl = config.heliusRpcUrl;
    const wsUrl   = httpUrl
      .replace('https://', 'wss://')
      .replace('http://', 'ws://');

    const safeUrl = wsUrl.replace(/api-key=[^&]+/, 'api-key=***');
    console.log(`🔌 WS: Connecting to Helius → ${safeUrl}`);

    try {
      this.connection = new Connection(httpUrl, {
        wsEndpoint: wsUrl,
        commitment: 'confirmed',
      });

      for (const [name, programId] of Object.entries(DEX_PROGRAMS)) {
        const subId = this.connection.onLogs(
          new PublicKey(programId),
          (logs) => this._onLogs(name, logs),
          'confirmed'
        );
        this.subscriptionIds.push({ id: subId, name });
        console.log(`   📡 Subscribed: ${name}`);
      }

      this.running           = true;
      this.reconnectAttempts = 0;
      console.log(`🟢 WS Monitor live — watching ${Object.keys(DEX_PROGRAMS).length} DEX programs\n`);

    } catch (err) {
      console.error(`WS connect failed: ${err.message}`);
      this._scheduleReconnect();
    }
  }

  _onLogs(dexName, logResult) {
    if (logResult.err) return; // failed tx — skip

    this.swapEventCount++;

    // Debounce: collapse burst of events into one scan trigger
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      const now = Date.now();
      if (now - this.lastScanAt < MIN_SCAN_INTERVAL_MS) return; // cooldown
      this.lastScanAt = now;
      this.triggeredScans++;
      this.onSwapDetected(dexName);
    }, DEBOUNCE_MS);
  }

  _scheduleReconnect() {
    this.reconnectAttempts++;
    const delay = Math.min(5000 * this.reconnectAttempts, 60_000);
    console.warn(`WS: reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts})...`);
    setTimeout(() => this.start(), delay);
  }

  async stop() {
    this.running = false;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    for (const { id } of this.subscriptionIds) {
      try { await this.connection.removeOnLogsListener(id); } catch {}
    }
    console.log('WS Monitor stopped');
  }

  getStats() {
    return {
      swapEventCount: this.swapEventCount,
      triggeredScans:  this.triggeredScans,
    };
  }
}
