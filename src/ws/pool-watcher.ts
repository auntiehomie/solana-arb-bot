/**
 * Pool account watcher.
 *
 * Discovers top liquidity pool accounts for target token pairs
 * from Meteora and Orca APIs, then subscribes to on-chain account
 * changes via Helius WebSocket. Fires a callback in ~20ms on any swap.
 */

import axios from 'axios';
import { Connection, PublicKey, AccountInfo, Context } from '@solana/web3.js';
import { logger } from '../utils/logger';

export interface PoolAccount {
  address: string;
  dex: string;
  tokenA: string;  // symbol
  tokenB: string;  // symbol
  mintA: string;   // mint address
  mintB: string;   // mint address
}

export type PoolUpdateCallback = (pool: PoolAccount) => void;

// Target token mints — keep in sync with TOKENS in types.ts
const MINTS: Record<string, string> = {
  SOL:    'So11111111111111111111111111111111111111112',
  USDC:   'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  BONK:   'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  JUP:    'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
  WIF:    'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
  RAY:    '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
  PYTH:   'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3',
  POPCAT: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr',
  PENGU:  '2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv',
};

const SYMBOL_BY_MINT = Object.fromEntries(Object.entries(MINTS).map(([s, m]) => [m, s]));

interface MeteoraPool {
  address: string;
  mint_x: string;
  mint_y: string;
  liquidity: string;
}

interface OrcaPool {
  address: string;
  tokenA: { mint: string };
  tokenB: { mint: string };
  tvl: number;
}

// Well-known high-liquidity pool addresses as reliable fallback
const FALLBACK_POOLS: PoolAccount[] = [
  { address: 'Ek5MWmZQe7MQrVHUDMbVB8GhyjPMQb4JZhHiRBpCPZSF', dex: 'Meteora', tokenA: 'SOL',    tokenB: 'BONK', mintA: MINTS.SOL,  mintB: MINTS.BONK },
  { address: '2MKKLSAnu3PbwKRFAR3FzMaBNFRXBQkEEBBaqfheqnCt', dex: 'Meteora', tokenA: 'JUP',    tokenB: 'BONK', mintA: MINTS.JUP,  mintB: MINTS.BONK },
  { address: 'BVNo8ftg2LkkssnWT4ZWdtoAgnGFgViV7KzoFiA5K1t7', dex: 'Orca',    tokenA: 'SOL',    tokenB: 'BONK', mintA: MINTS.SOL,  mintB: MINTS.BONK },
  // SOL/USDC — highest volume pair on Solana
  { address: 'HJPjoWUrhoZzkNfRpHuieeFk9WcZWjwy6PBjZ81ngndJ', dex: 'Orca',    tokenA: 'SOL',    tokenB: 'USDC', mintA: MINTS.SOL,  mintB: MINTS.USDC },
  // SOL/WIF — high volatility, frequent arb
  { address: 'EP2ib6dYdEeqD8MfE2ezHCxX3kP3K2oundjb8b3UT5FA', dex: 'Orca',    tokenA: 'SOL',    tokenB: 'WIF',  mintA: MINTS.SOL,  mintB: MINTS.WIF  },
  // RAY/SOL — Raydium's native token, deep liquidity
  { address: 'AVs9TA4nWDzfPJE9gGVNs98QEF3u3FJFE3EGZS4tS6zW', dex: 'Orca',    tokenA: 'RAY',    tokenB: 'SOL',  mintA: MINTS.RAY,  mintB: MINTS.SOL  },
];

// Fetch top Meteora DLMM pools for target pairs
async function discoverMeteoraPools(pairs: [string, string][]): Promise<PoolAccount[]> {
  try {
    // Use /pair/all — simpler endpoint, no pagination params needed
    const resp = await axios.get<MeteoraPool[]>(
      'https://dlmm-api.meteora.ag/pair/all',
      { timeout: 15_000 }
    );
    const data = Array.isArray(resp.data) ? resp.data : [];
    const pools: PoolAccount[] = [];
    for (const pool of data) {
      const symA = SYMBOL_BY_MINT[pool.mint_x];
      const symB = SYMBOL_BY_MINT[pool.mint_y];
      if (!symA || !symB) continue;
      const isTarget = pairs.some(
        ([a, b]) => (a === symA && b === symB) || (a === symB && b === symA)
      );
      if (!isTarget) continue;
      pools.push({
        address: pool.address,
        dex: 'Meteora',
        tokenA: symA,
        tokenB: symB,
        mintA: pool.mint_x,
        mintB: pool.mint_y,
      });
    }
    // Sort by liquidity descending
    pools.sort((a, b) => {
      const lA = Number((data.find(p => p.address === a.address) as MeteoraPool & { liquidity?: string })?.liquidity ?? 0);
      const lB = Number((data.find(p => p.address === b.address) as MeteoraPool & { liquidity?: string })?.liquidity ?? 0);
      return lB - lA;
    });
    logger.info(`Discovered ${pools.length} Meteora pool(s)`);
    return pools.slice(0, 5);
  } catch (err) {
    logger.warn('Meteora pool discovery failed — using fallback addresses');
    return FALLBACK_POOLS.filter(p => p.dex === 'Meteora');
  }
}

// Fetch top Orca Whirlpool pools for target pairs
async function discoverOrcaPools(pairs: [string, string][]): Promise<PoolAccount[]> {
  try {
    const resp = await axios.get<OrcaPool[]>(
      'https://api.mainnet.orca.so/v1/whirlpool/list',
      { timeout: 10_000 }
    );
    const list = (resp.data as unknown as { whirlpools: OrcaPool[] }).whirlpools ?? resp.data;
    const pools: PoolAccount[] = [];
    for (const pool of list) {
      const symA = SYMBOL_BY_MINT[pool.tokenA?.mint];
      const symB = SYMBOL_BY_MINT[pool.tokenB?.mint];
      if (!symA || !symB) continue;
      const isTarget = pairs.some(
        ([a, b]) => (a === symA && b === symB) || (a === symB && b === symA)
      );
      if (!isTarget) continue;
      pools.push({
        address: pool.address,
        dex: 'Orca',
        tokenA: symA,
        tokenB: symB,
        mintA: pool.tokenA.mint,
        mintB: pool.tokenB.mint,
      });
    }
    // Sort by TVL descending, take top 4
    pools.sort((a, b) => {
      const tvlA = (list.find(p => p.address === a.address)?.tvl ?? 0);
      const tvlB = (list.find(p => p.address === b.address)?.tvl ?? 0);
      return tvlB - tvlA;
    });
    logger.info(`Discovered ${pools.length} Orca pool(s)`);
    return pools.slice(0, 3);
  } catch (err) {
    logger.warn('Orca pool discovery failed — using fallback addresses');
    return FALLBACK_POOLS.filter(p => p.dex === 'Orca');
  }
}

export class PoolWatcher {
  private subscriptionIds: number[] = [];
  private pools: PoolAccount[] = [];
  private callback: PoolUpdateCallback;
  private connection: Connection;

  constructor(connection: Connection, callback: PoolUpdateCallback) {
    this.connection = connection;
    this.callback = callback;
  }

  async start(): Promise<void> {
    const pairs: [string, string][] = [
      ['SOL', 'BONK'],
      ['SOL', 'WIF'],
      ['SOL', 'USDC'],
      ['SOL', 'RAY'],
      ['JUP', 'BONK'],
      ['JUP', 'SOL'],
      ['WIF', 'BONK'],
      ['PYTH', 'SOL'],
      ['POPCAT', 'SOL'],
    ];

    logger.info('Discovering pool accounts...');
    const [meteoraPools, orcaPools] = await Promise.all([
      discoverMeteoraPools(pairs),
      discoverOrcaPools(pairs),
    ]);

    // Deduplicate by address
    const seen = new Set<string>();
    const merged = [...meteoraPools, ...orcaPools];
    this.pools = merged.filter(p => seen.has(p.address) ? false : (seen.add(p.address), true));

    if (this.pools.length === 0) {
      logger.warn('No pool accounts discovered — falling back to polling only');
      return;
    }

    // Helius free tier: max 10 WS subscriptions.
    // confirmTransaction uses signatureSubscribe internally — keep pool subs low.
    const MAX_SUBS = 5;
    const poolsToWatch = this.pools.slice(0, MAX_SUBS);
    logger.info(`Subscribing to ${poolsToWatch.length} pool accounts via WebSocket (cap: ${MAX_SUBS})...`);

    for (const pool of poolsToWatch) {
      try {
        const pubkey = new PublicKey(pool.address);
        const subId = this.connection.onAccountChange(
          pubkey,
          (_info: AccountInfo<Buffer>, _ctx: Context) => {
            logger.debug(`Pool update: ${pool.dex} ${pool.tokenA}/${pool.tokenB} @ ${pool.address}`);
            this.callback(pool);
          },
          'confirmed'
        );
        this.subscriptionIds.push(subId);
        logger.info(`  ✓ ${pool.dex} ${pool.tokenA}/${pool.tokenB} → ${pool.address}`);
      } catch (err) {
        logger.warn(`Failed to subscribe to ${pool.address}`, err);
      }
    }

    logger.info(`WebSocket subscriptions active: ${this.subscriptionIds.length}`);
  }

  getPoolCount(): number {
    return this.pools.length;
  }

  async stop(): Promise<void> {
    for (const id of this.subscriptionIds) {
      try {
        await this.connection.removeAccountChangeListener(id);
      } catch { /* ignore */ }
    }
    this.subscriptionIds = [];
  }
}
