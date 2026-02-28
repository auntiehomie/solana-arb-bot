/**
 * LiveTrader - Executes real on-chain arbitrage trades via Jupiter Swap API v6
 *
 * Safety layers (innermost → outermost):
 *   1. DRY_RUN    – builds + signs tx but never submits (default ON until you flip it)
 *   2. MAX_TRADE  – hard cap per trade in USD
 *   3. CIRCUIT BREAKER – halts the session if daily loss exceeds limit
 *   4. SOL balance check – won't trade if gas reserve would be breached
 *
 * ⚠️  Never set PAPER_MODE=false AND DRY_RUN=false at the same time
 *     without a funded wallet and explicit review of every safety param.
 */

import {
  Connection,
  Keypair,
  VersionedTransaction,
  PublicKey,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import bs58 from 'bs58';
import axios from 'axios';
import { config, getTokenMint } from './config.js';
import { dbQueries } from './db/queries.js';
import { DiscordNotifier } from './discord.js';

// notifier for immediate alerts on partial failures
const notifier = new DiscordNotifier();

// ── Constants ────────────────────────────────────────────────────────────────

const JUPITER_QUOTE_API  = 'https://public.jupiterapi.com/quote';
const JUPITER_SWAP_API   = 'https://public.jupiterapi.com/swap';
const SOL_PRICE_API      = 'https://api.coinbase.com/v2/prices/SOL-USD/spot';
const WSOL_MINT          = 'So11111111111111111111111111111111111111112';
const BASE_DECIMALS      = 9;   // SOL / lamports
const CONFIRM_TIMEOUT_MS = 60_000;
const MAX_RETRIES        = 2;

// Each Solana tx costs ~0.000005 SOL base + up to ~0.001 SOL priority fee.
// Two legs per trade = ~0.002 SOL max per round-trip.
// Default reserve covers ~5 full round-trips at high priority, configurable via SOL_GAS_RESERVE env.
const SOL_GAS_RESERVE_DEFAULT = 0.01;

// ── Helpers ──────────────────────────────────────────────────────────────────

function usdToLamports(usd, solPriceUsd) {
  return Math.floor((usd / solPriceUsd) * LAMPORTS_PER_SOL);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── LiveTrader ────────────────────────────────────────────────────────────────

export class LiveTrader {
  constructor() {
    this._validateEnv();

    this.connection = new Connection(config.rpcUrl, 'confirmed');
    this.wallet     = this._loadWallet();
    this.dryRun     = config.dryRun;
    this.balance    = config.startingCapital;   // tracked in USD

    // SOL price cache
    this._solPriceUsd = null;
    this._solPriceTs  = 0;

    // Circuit breaker state
    this._dailyLoss      = 0;
    this._dailyLossReset = this._todayMidnightUtc();
    this._halted         = false;

    // Adaptive profit override state (per-pair consecutive sell failures)
    // Tracks counts of consecutive sell failures for each pair
    this._sellFailureCounts = {}; // { 'RAY/SOL': 0, ... }
    this._failureThreshold   = 3; // after N consecutive failures, raise required profit
    this._raisedMinProfitPct = 0.01; // 1.0% required when in raised mode

    console.log(`\n🔑 Wallet: ${this.wallet.publicKey.toBase58()}`);
    console.log(`🧪 Dry-run: ${this.dryRun ? 'ON  (transactions will NOT be submitted)' : '⚠️  OFF – REAL TRADES ENABLED'}`);
    console.log(`🛡️  Max trade size : $${config.maxTradeAmountUsd}`);
    console.log(`🛡️  Daily loss limit: $${config.maxDailyLossUsd}`);
    console.log(`🛡️  SOL gas reserve : ${config.solGasReserve} SOL (~$${(config.solGasReserve * 170).toFixed(2)} at $170/SOL)\n`);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Fetch current SOL price in USD (cached for 60s to avoid hammering the API).
   */
  async _fetchSolPrice() {
    const now = Date.now();
    if (this._solPriceUsd && now - this._solPriceTs < 60_000) {
      return this._solPriceUsd;
    }
    try {
      const { data } = await axios.get(SOL_PRICE_API, { timeout: 5_000 });
      this._solPriceUsd = parseFloat(data.data.amount);
      this._solPriceTs  = now;
      return this._solPriceUsd;
    } catch (err) {
      console.warn(`⚠️  Could not fetch SOL price: ${err.message} – using cached $${this._solPriceUsd ?? 0}`);
      return this._solPriceUsd ?? 0;
    }
  }

  /**
   * Read native SOL balance from chain and seed this.balance (in USD).
   * Call once at startup before the scan loop.
   */
  async init() {
    try {
      const solPrice  = await this._fetchSolPrice();
      const lamports  = await this.connection.getBalance(this.wallet.publicKey);
      const solAmount = lamports / LAMPORTS_PER_SOL;
      // Reserve gas before advertising available capital
      const tradeable = Math.max(0, solAmount - config.solGasReserve);
      this.balance    = tradeable * solPrice;
      console.log(`☀️  SOL balance: ${solAmount.toFixed(4)} SOL @ $${solPrice.toFixed(2)} = $${(solAmount * solPrice).toFixed(2)}`);
      console.log(`💵 Available for trading (after ${config.solGasReserve} SOL gas reserve): $${this.balance.toFixed(2)}`);

      // Start background auto-sell poll for any non-SOL tokens that appear in the wallet
      this._startTokenAutoSellPoll();

    } catch (err) {
      console.warn(`⚠️  Could not read on-chain SOL balance: ${err.message} – using STARTING_CAPITAL`);
    }
  }

  /**
   * Execute an arbitrage opportunity.
   * Returns a trade record or null if skipped/failed.
   */
  async executeTrade(opportunity) {
    if (this._halted) {
      console.warn('⛔ Circuit breaker HALTED – skipping trade');
      return null;
    }

    const tradeAmountUsd = this._calcTradeAmount(opportunity);
    if (tradeAmountUsd === 0) return null;

    console.log(`\n⚡ Executing LIVE trade: ${opportunity.pair}`);
    console.log(`   Buy  on ${opportunity.buyExchange}  @ $${opportunity.buyPrice.toFixed(6)}`);
    console.log(`   Sell on ${opportunity.sellExchange} @ $${opportunity.sellPrice.toFixed(6)}`);
    console.log(`   Trade size: $${tradeAmountUsd.toFixed(2)}`);

    try {
      // Step 0 – refresh SOL price for this trade cycle
      const solPrice = await this._fetchSolPrice();

      // Step 1 – verify we have enough SOL for gas + trade
      await this._assertGasReserve(tradeAmountUsd, solPrice);

      // Step 2 – get Jupiter quote for buy leg (SOL → base token)
      const [base] = opportunity.pair.split('/');
      const buyLamports = usdToLamports(tradeAmountUsd, solPrice);
      const buyQuote    = await this._getQuote('SOL', base, null, opportunity.buyExchange, buyLamports);
      if (!buyQuote) throw new Error('Could not get buy quote from Jupiter');

      // Step 3 – get Jupiter quote for sell leg (base token → SOL)
      const tokensOut = parseInt(buyQuote.outAmount);
      const sellQuote = await this._getQuote(base, 'SOL', null, opportunity.sellExchange, tokensOut);
      if (!sellQuote) throw new Error('Could not get sell quote from Jupiter');

      // Step 4 – sanity check: is the spread still profitable after real quotes?
      const realBuySol   = buyLamports / LAMPORTS_PER_SOL;
      const realSellSol  = parseInt(sellQuote.outAmount) / LAMPORTS_PER_SOL;
      const realBuyUsd   = realBuySol  * solPrice;
      const realSellUsd  = realSellSol * solPrice;
      const realProfit   = realSellUsd - realBuyUsd;
      const realProfitPct = (realProfit / realBuyUsd) * 100;

      console.log(`   Quote spread: buy=${realBuySol.toFixed(4)} SOL sell=${realSellSol.toFixed(4)} SOL profit=$${realProfit.toFixed(4)} (${realProfitPct.toFixed(3)}%)`);

      // Determine effective minimum profit percent (supports adaptive raise after failures)
      const effectiveMinProfit = this._getEffectiveMinProfitPercent(opportunity.pair);
      if (realProfit <= 0 || realProfitPct < effectiveMinProfit * 100) {
        console.log(`   ⚠️  Real quote spread no longer profitable – skipped (required ${ (effectiveMinProfit*100).toFixed(3) }% )`);
        return null;
      }

      // Step 5 – build, sign, (optionally) submit transactions
      // SECURITY: simulate both legs before submitting the buy to avoid single-leg exposure
      const buySimOk  = await this._simulateSwap(buyQuote, `SIM-BUY ${base}`);
      const sellSimOk = await this._simulateSwap(sellQuote, `SIM-SELL ${base}`);
      if (!buySimOk || !sellSimOk) {
        console.log('   ⚠️  Simulation failed for one or both legs — skipping trade to avoid partial fills');
        return null;
      }
      let buyTxId  = null;
      let sellTxId = null;

      if (!this.dryRun) {
        buyTxId  = await this._submitSwap(buyQuote,  `BUY  ${base}`);
        if (!buyTxId) throw new Error('Buy tx failed – aborting sell leg');

        // Attempt sell with retries (configurable)
        const sellRetries = typeof config.sellRetryCount === 'number' ? config.sellRetryCount : 3;
        let attemptSell = 0;
        while (attemptSell <= sellRetries && !sellTxId) {
          attemptSell++;
          sellTxId = await this._submitSwap(sellQuote, `SELL ${base} (attempt ${attemptSell})`);
          if (sellTxId) break;
          console.error(`   ❌ Sell attempt ${attemptSell} failed`);
          // Log sellQuote response for debugging (trim large fields)
          try {
            const debug = { outAmount: sellQuote?.outAmount, routes: sellQuote?.routes?.length, raw: sellQuote?.data?.error || null };
            console.warn('   Sell quote debug:', JSON.stringify(debug));
          } catch (e) {
            console.warn('   Could not stringify sellQuote for debug');
          }
          if (attemptSell <= sellRetries) await sleep(1500 * attemptSell); // backoff
        }

        if (!sellTxId) {
          console.error('   ❌ Sell leg failed after buy completed – manual intervention needed!');
          // Increment consecutive sell-failure counter for this pair
          const pairKey = opportunity.pair;
          this._sellFailureCounts[pairKey] = (this._sellFailureCounts[pairKey] || 0) + 1;
          console.warn(`   🔺 Sell failures for ${pairKey}: ${this._sellFailureCounts[pairKey]} (threshold=${this._failureThreshold})`);

          // If we've reached the threshold, notify and rely on adaptive behavior for future opportunities
          if (this._sellFailureCounts[pairKey] >= this._failureThreshold) {
            try {
              const msg = `⚠️ Adaptive: raising required profit to ${(this._raisedMinProfitPct*100).toFixed(2)}% for ${pairKey} after ${this._sellFailureCounts[pairKey]} consecutive sell failures.`;
              await notifier.send(msg);
            } catch (e) {
              console.warn('Failed to send adaptive-alert:', e.message);
            }
          }

          // Send immediate Discord alert for partial trade (buy succeeded, sell failed)
          try {
            const alert = `⚠️ Partial trade: BUY succeeded but SELL failed for ${opportunity.pair}.\nBuy TX: https://solscan.io/tx/${buyTxId}\nAttempts: ${sellRetries + 1}\nTrade amount: $${tradeAmountUsd.toFixed(2)}\nPlease investigate.`;
            await notifier.send(alert);
          } catch (e) {
            console.warn('Failed to send partial-trade alert:', e.message);
          }
          // Don't throw – record the partial trade so the user can see it
        } else {
          // Sell succeeded — clear consecutive-failure counter and (if previously raised) notify revert
          const pairKey = opportunity.pair;
          if (this._sellFailureCounts[pairKey]) {
            this._sellFailureCounts[pairKey] = 0;
            try {
              const msg = `✅ Sell succeeded for ${pairKey} — reverting adaptive profit requirement to ${(config.minProfitPercent*100).toFixed(2)}%`;
              await notifier.send(msg);
            } catch (e) {
              console.warn('Failed to send revert-alert:', e.message);
            }
          }
        }
      } else {
        console.log('   🧪 DRY RUN – skipping on-chain submission');
        buyTxId  = 'dry-run-buy';
        sellTxId = 'dry-run-sell';
      }

      // Step 6 – update balance + circuit breaker
      this.balance += realProfit;
      if (realProfit < 0) this._recordLoss(Math.abs(realProfit));

      const trade = {
        timestamp:    Date.now(),
        pair:         opportunity.pair,
        buyExchange:  opportunity.buyExchange,
        sellExchange: opportunity.sellExchange,
        // Record the real quote-derived prices (USD) to avoid zeros from upstream objects
        buyPrice:     realBuyUsd,
        sellPrice:    realSellUsd,
        amount:       tradeAmountUsd,
        profitUsd:    realProfit,
        profitPercent: realProfitPct,
        simulated:    this.dryRun,
        executed:     true,
        // Only include tx ids in notes when present to avoid literal "null" strings
        notes:        `buy_tx=${buyTxId ? buyTxId : ''}${sellTxId ? ' sell_tx=' + sellTxId : ''}`,
      };

      // Alert if realized profit differs from quoted by more than threshold
      try {
        const alertThresh = parseFloat(process.env.ALERT_QUOTE_DIFF_USD || '0');
        if (alertThresh > 0) {
          let quotedProfitUsd = 0;
          try {
            if (opportunity.buyPrice && opportunity.sellPrice && opportunity.buyPrice > 0) {
              const profitPct = (opportunity.sellPrice - opportunity.buyPrice) / opportunity.buyPrice;
              quotedProfitUsd = tradeAmountUsd * profitPct;
            }
          } catch (e) { quotedProfitUsd = 0; }

          const diff = Math.abs(realProfit - quotedProfitUsd);
          if (diff >= alertThresh) {
            const msg = `⚠️ Profit discrepancy: quoted=$${quotedProfitUsd.toFixed(4)} realized=$${realProfit.toFixed(4)} diff=$${diff.toFixed(4)} for ${opportunity.pair} \nBuy TX: ${buyTxId || ''} \nSell: ${sellTxId || ''}`;
            try { notifier.send(msg).catch(e=>{ console.warn('Alert send failed:', e.message); }); } catch(e){ console.warn('Alert send failed:', e.message); }
          }
        }
      } catch(e){ console.warn('Alert check failed:', e.message); }

      dbQueries.recordTrade(trade);

      const balanceRecord = dbQueries.getCurrentBalance();
      const newTotalTrades    = (balanceRecord?.total_trades    || 0) + 1;
      const newWinningTrades  = (balanceRecord?.winning_trades  || 0) + (realProfit > 0 ? 1 : 0);
      const newTotalProfit    = (balanceRecord?.total_profit    || 0) + realProfit;
      dbQueries.updateBalance(this.balance, newTotalTrades, newWinningTrades, newTotalProfit);

      console.log(`   ✅ Trade complete! Profit: $${realProfit.toFixed(4)} | Balance: $${this.balance.toFixed(2)}`);
      return trade;

    } catch (err) {
      console.error(`   ❌ Trade failed: ${err.message}`);
      return null;
    }
  }

  getBalance() { return this.balance; }

  getStats() {
    const r = dbQueries.getCurrentBalance();
    return {
      currentBalance:  this.balance,
      startingBalance: config.startingCapital,
      totalProfit:     r?.total_profit    || 0,
      totalTrades:     r?.total_trades    || 0,
      winningTrades:   r?.winning_trades  || 0,
      winRate: r?.total_trades > 0
        ? ((r.winning_trades / r.total_trades) * 100).toFixed(2)
        : 0,
    };
  }

  // ── Private: wallet ────────────────────────────────────────────────────────

  _loadWallet() {
    const raw = process.env.WALLET_PRIVATE_KEY;
    if (!raw) throw new Error('WALLET_PRIVATE_KEY not set in .env');

    try {
      // Accept both base58 string and JSON uint8 array
      const secret = raw.startsWith('[')
        ? Uint8Array.from(JSON.parse(raw))
        : bs58.decode(raw);
      return Keypair.fromSecretKey(secret);
    } catch (e) {
      throw new Error(`Invalid WALLET_PRIVATE_KEY: ${e.message}`);
    }
  }

  // ── Private: Jupiter ───────────────────────────────────────────────────────

  /**
   * Fetch a Jupiter quote.
   * @param {string} inputSymbol   e.g. 'USDC'
   * @param {string} outputSymbol  e.g. 'SOL'
   * @param {number|null} inputUsd USD amount (used when inputSymbol is USDC)
   * @param {string} dex           Preferred DEX label (best-effort filter)
   * @param {number|null} inputRaw Raw token units (used for sell leg)
   */
  async _getQuote(inputSymbol, outputSymbol, inputUsd = null, dex = null, inputRaw = null) {
    const inputMint  = getTokenMint(inputSymbol);
    const outputMint = getTokenMint(outputSymbol);
    if (!inputMint || !outputMint) return null;

    // All amounts are passed as raw lamports (inputRaw). inputUsd path left for compatibility.
    const amount = inputRaw !== null
      ? inputRaw
      : Math.floor(inputUsd * 10 ** BASE_DECIMALS);

    const params = {
      inputMint,
      outputMint,
      amount,
      slippageBps: Math.floor(config.slippageTolerance * 10_000), // e.g. 0.03 → 300 bps
      onlyDirectRoutes: false,
    };

    // Note: do NOT restrict by dex — Jupiter auto-routes to best execution price.
    // Forcing a specific DEX via `dexes` param frequently causes 400/no-route errors.

    try {
      const { data } = await axios.get(JUPITER_QUOTE_API, { params, timeout: 8_000 });
      return data;
    } catch (err) {
      console.error(`   Jupiter quote error (${inputSymbol}→${outputSymbol}): ${err.message}`);
      return null;
    }
  }

  /**
   * Build a swap transaction from a Jupiter quote, sign it, and submit.
   * Returns the transaction signature (string) or null on failure.
   */
  async _submitSwap(quote, label = 'swap') {
    // Helper: fetch swap tx blob from Jupiter (used by submit and simulate)
    const fetchSwapTx = async () => {
      const { data: swapData } = await axios.post(JUPITER_SWAP_API, {
        quoteResponse:         quote,
        userPublicKey:         this.wallet.publicKey.toBase58(),
        wrapAndUnwrapSol:      true,
        computeUnitPriceMicroLamports: 'auto',
      }, { timeout: 10_000 });
      return swapData.swapTransaction;
    };

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        // 1. Get serialized swap transaction from Jupiter
        const swapTxB64 = await fetchSwapTx();

        // 2. Deserialize
        const txBuf = Buffer.from(swapTxB64, 'base64');
        const tx    = VersionedTransaction.deserialize(txBuf);

        // 3. Sign
        tx.sign([this.wallet]);

        // 4. Send
        const rawTx = tx.serialize();
        const sig   = await this.connection.sendRawTransaction(rawTx, {
          skipPreflight:       false,
          maxRetries:          2,
          preflightCommitment: 'confirmed',
        });

        console.log(`   📡 ${label} submitted: https://solscan.io/tx/${sig}`);

        // 5. Confirm
        const confirmed = await this._confirmTx(sig);
        if (!confirmed) throw new Error(`TX not confirmed within ${CONFIRM_TIMEOUT_MS / 1000}s`);

        console.log(`   ✅ ${label} confirmed`);
        return sig;

      } catch (err) {
        console.error(`   ❌ ${label} attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`);
        if (attempt < MAX_RETRIES) await sleep(2000);
      }
    }
    return null;
  }

  async _confirmTx(sig) {
    const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const status = await this.connection.getSignatureStatus(sig, { searchTransactionHistory: true });
      const conf   = status?.value?.confirmationStatus;
      if (conf === 'confirmed' || conf === 'finalized') return true;
      if (status?.value?.err) {
        console.error(`   TX error: ${JSON.stringify(status.value.err)}`);
        return false;
      }
      await sleep(2000);
    }
    return false;
  }

  // ── Private: safety ────────────────────────────────────────────────────────

  _getEffectiveMinProfitPercent(pair) {
    const pairKey = pair || '';
    const failures = this._sellFailureCounts[pairKey] || 0;
    if (failures >= this._failureThreshold) return this._raisedMinProfitPct;
    return config.minProfitPercent;
  }

  // ── Auto-sell: detect non-SOL tokens in wallet and attempt immediate sell
  _startTokenAutoSellPoll() {
    const interval = config.updateIntervalMs || 60_000;
    console.log(`🔁 Auto-sell: starting wallet token poll every ${interval/1000}s`);
    this._autoSellTimer = setInterval(() => {
      this._scanWalletTokens().catch(err => console.warn('Auto-sell scan error:', err.message));
    }, interval);
    // Run once immediately
    this._scanWalletTokens().catch(err => console.warn('Auto-sell initial scan error:', err.message));
  }

  async _scanWalletTokens() {
    // Fetch token accounts owned by the wallet
    const resp = await this.connection.getParsedTokenAccountsByOwner(this.wallet.publicKey, { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }, 'confirmed');
    if (!resp || !resp.value) return;
    const solPrice = await this._fetchSolPrice();

    for (const { pubkey, account } of resp.value) {
      try {
        const parsed = account.data.parsed.info;
        const mint = parsed.mint;
        const uiAmount = parsed.tokenAmount.uiAmount || 0;
        const amountRaw = parsed.tokenAmount.amount ? parseInt(parsed.tokenAmount.amount) : 0;
        if (uiAmount <= 0) continue;
        // Skip SOL (native) and dusts
        if (mint === config.baseMint) continue;

        // Try to map mint -> symbol from config.tokens
        const symbol = Object.keys(config.tokens).find(k => config.tokens[k] === mint);
        if (!symbol) {
          console.log(`   Auto-sell: unknown mint ${mint} with balance ${uiAmount} — skipping`);
          continue;
        }

        // Determine USD value by asking Jupiter for a quote token->SOL for the raw amount
        const sellQuote = await this._getQuote(symbol, 'SOL', null, null, amountRaw);
        if (!sellQuote) {
          console.warn(`   Auto-sell: could not get sell quote for ${symbol}`);
          continue;
        }
        const sellSol = (parseInt(sellQuote.outAmount) || 0) / LAMPORTS_PER_SOL;
        const usdValue = sellSol * solPrice;
        // Skip tiny dust balances — don't auto-sell below the dust threshold
        if (usdValue < config.dustUsd) {
          console.log(`   Auto-sell: ${symbol} balance ${uiAmount} ≈ $${usdValue.toFixed(4)} < dust $${config.dustUsd} — skipping`);
          continue;
        }

        // Also skip if below cleanup minimum (avoid spending gas to cleanup tiny balances)
        if (usdValue < config.cleanupMinUsd) {
          console.log(`   Auto-sell: ${symbol} balance ${uiAmount} ≈ $${usdValue.toFixed(4)} < cleanup ${config.cleanupMinUsd} — deferring`);
          continue;
        }

        // Process auto sell
        await this._processAutoSell(symbol, amountRaw, uiAmount, usdValue);
      } catch (e) {
        console.warn('   Auto-sell loop error:', e.message);
      }
    }
  }

  async _processAutoSell(symbol, amountRaw, uiAmount, usdValue) {
    console.log(`   Auto-sell: attempting to sell ${uiAmount} ${symbol} (≈ $${usdValue.toFixed(2)})`);
    try {
      // Reuse _getQuote + _submitSwap flow like executeTrade
      const sellQuote = await this._getQuote(symbol, 'SOL', null, null, amountRaw);
      if (!sellQuote) throw new Error('No sell quote');

      // Build/submit
      if (this.dryRun) {
        console.log(`   🧪 Auto-sell dry-run: would submit swap for ${symbol}`);
        await notifier.send(`🧪 Auto-sell dry-run: ${symbol} balance ~${usdValue.toFixed(2)} would be sold (dry-run)`);
        return;
      }

      // Ensure gas reserve
      const solPrice = await this._fetchSolPrice();
      const requiredSol = (usdValue / solPrice) + config.solGasReserve;
      const lamports = await this.connection.getBalance(this.wallet.publicKey);
      const solBalance = lamports / LAMPORTS_PER_SOL;
      if (solBalance < config.solGasReserve) {
        console.warn('   Auto-sell aborted: insufficient SOL for fees');
        await notifier.send(`⚠️ Auto-sell aborted for ${symbol}: insufficient SOL for fees`);
        return;
      }

      const txId = await this._submitSwap(sellQuote, `AUTO-SELL ${symbol}`);
      if (txId) {
        console.log(`   Auto-sell success: https://solscan.io/tx/${txId}`);
        await notifier.send(`✅ Auto-sell: sold ${symbol} (~$${usdValue.toFixed(2)}) → https://solscan.io/tx/${txId}`);
        // reset failure counts on success
        if (this._sellFailureCounts[`${symbol}/SOL`]) this._sellFailureCounts[`${symbol}/SOL`] = 0;
      } else {
        console.warn('   Auto-sell failed');
        await notifier.send(`❌ Auto-sell failed for ${symbol} (~$${usdValue.toFixed(2)})`);
      }
    } catch (e) {
      console.warn('   Auto-sell error:', e.message);
      await notifier.send(`❌ Auto-sell error for ${symbol}: ${e.message}`);
    }
  }

  _validateEnv() {
    if (!config.rpcUrl) throw new Error('SOLANA_RPC_URL not set');
    if (!config.paperMode && !process.env.WALLET_PRIVATE_KEY) {
      throw new Error('WALLET_PRIVATE_KEY required for live trading');
    }
  }

  _calcTradeAmount(opportunity) {
    // Hard cap: never exceed MAX_TRADE_AMOUNT_USD
    const maxByConfig = config.maxTradeAmountUsd;
    // Soft cap: use up to 95% of current USD balance (leave a sliver for rounding)
    const maxByBalance = this.balance * 0.95;

    const tradeAmount = Math.min(maxByConfig, maxByBalance);

    // Check minimum profit in absolute terms
    const profitPerDollar = (opportunity.sellPrice - opportunity.buyPrice) / opportunity.buyPrice;
    const estimatedProfit = tradeAmount * profitPerDollar;

    if (estimatedProfit < config.minProfitAbsolute) {
      console.log(`   ⚠️  Est. profit $${estimatedProfit.toFixed(4)} < min $${config.minProfitAbsolute} – skipping`);
      return 0;
    }

    return tradeAmount;
  }

  async _assertGasReserve(tradeAmountUsd = 0, solPriceUsd = 0) {
    const reserve    = config.solGasReserve;
    const lamports   = await this.connection.getBalance(this.wallet.publicKey);
    const solBalance = lamports / LAMPORTS_PER_SOL;
    const tradeSol   = solPriceUsd > 0 ? tradeAmountUsd / solPriceUsd : 0;
    const required   = reserve + tradeSol;
    if (solBalance < required) {
      throw new Error(
        `Insufficient SOL: have ${solBalance.toFixed(4)}, need ${required.toFixed(4)} ` +
        `(${tradeSol.toFixed(4)} trade + ${reserve} gas reserve). Top up wallet.`
      );
    }
  }

  _recordLoss(amount) {
    // Reset daily loss counter at midnight UTC
    if (Date.now() >= this._dailyLossReset) {
      this._dailyLoss      = 0;
      this._dailyLossReset = this._todayMidnightUtc();
    }
    this._dailyLoss += amount;
    if (this._dailyLoss >= config.maxDailyLossUsd) {
      this._halted = true;
      console.error(`\n🚨 CIRCUIT BREAKER TRIGGERED – daily loss $${this._dailyLoss.toFixed(2)} >= limit $${config.maxDailyLossUsd}`);
      console.error('   Bot halted for the rest of the day. Restart tomorrow or increase MAX_DAILY_LOSS_USD.\n');
    }
  }

  _todayMidnightUtc() {
    const d = new Date();
    d.setUTCHours(24, 0, 0, 0);
    return d.getTime();
  }
}
