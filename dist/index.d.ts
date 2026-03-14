/**
 * Solana Arbitrage Bot — Entry Point
 *
 * Main loop:
 * 1. Load config & validate env
 * 2. Init wallet
 * 3. Every SCAN_INTERVAL_MS:
 *    a. Fetch quotes from all DEXes in parallel
 *    b. Detect arbitrage opportunities
 *    c. Execute best opportunity via Jito (if not DRY_RUN)
 *    d. Log scan metrics
 */
export {};
//# sourceMappingURL=index.d.ts.map