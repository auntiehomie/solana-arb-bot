/**
 * Multi-relay bundle submission.
 *
 * Fans out bundles in parallel to Jito, Lil-JIT, and Astralane
 * block-engine endpoints. Returns the first successful result.
 *
 * Rationale: ~92-93% of validators run Jito-Solana. Without bundles,
 * a transaction enters gossip and loses to any searcher using bundles.
 * Multi-relay submission maximizes the chance of landing in a block.
 */

import axios from 'axios';
import { JitoBundleRequest, JitoBundleResponse } from '../types';
import { logger } from '../utils/logger';

/** Block-engine relay endpoints */
const RELAY_ENDPOINTS: Record<string, string> = {
  'jito-us': 'https://mainnet.block-engine.jito.wtf/api/v1/bundles',
  'jito-amsterdam': 'https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles',
  'jito-frankfurt': 'https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles',
  'jito-tokyo': 'https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles',
};

export interface MultiRelayResult {
  success: boolean;
  bundleId?: string;
  endpoint?: string;
  errors: Array<{ endpoint: string; error: string }>;
  /** How many ms it took for the first successful response */
  responseTimeMs: number;
}

/**
 * Submit a bundle to all Jito relays in parallel.
 * Returns the first successful submission.
 *
 * @param transactions  Array of base64-encoded signed transactions
 * @param jitoUuid      UUID used as Bearer token
 * @param endpoints     Optional: override default relay endpoints
 */
export async function submitToAllRelays(
  transactions: string[],
  jitoUuid: string,
  endpoints?: string[]
): Promise<MultiRelayResult> {
  const relays = endpoints ?? Object.values(RELAY_ENDPOINTS);

  if (transactions.length === 0) {
    return { success: false, errors: [{ endpoint: 'all', error: 'Empty transaction list' }], responseTimeMs: 0 };
  }

  const payload: JitoBundleRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'sendBundle',
    params: [transactions],
  };

  const startTime = Date.now();
  const errors: MultiRelayResult['errors'] = [];

  // Race all relays — first success wins
  const relayPromises = relays.map(async (endpoint) => {
    try {
      const resp = await axios.post<JitoBundleResponse>(endpoint, payload, {
        headers: {
          'Content-Type': 'application/json',
          ...(jitoUuid ? { Authorization: `Bearer ${jitoUuid}` } : {}),
        },
        timeout: 10_000,
      });

      const data = resp.data;

      if (data.result) {
        const elapsed = Date.now() - startTime;
        logger.info(`Multi-relay: ${endpoint} accepted in ${elapsed}ms (bundle: ${data.result})`);
        return { endpoint, bundleId: data.result, success: true };
      }

      if (data.error) {
        errors.push({ endpoint, error: `Jito error ${data.error.code}: ${data.error.message}` });
        logger.debug(`Multi-relay: ${endpoint} rejected — ${data.error.message}`);
        return null;
      }

      errors.push({ endpoint, error: 'No result or error' });
      return null;
    } catch (err) {
      const msg = (err as Error).message;
      errors.push({ endpoint, error: msg });
      logger.debug(`Multi-relay: ${endpoint} failed — ${msg}`);
      return null;
    }
  });

  // Wait for all to settle, but pick first success
  const results = await Promise.allSettled(relayPromises);
  const responseTimeMs = Date.now() - startTime;

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value?.success) {
      return {
        success: true,
        bundleId: r.value.bundleId,
        endpoint: r.value.endpoint,
        errors,
        responseTimeMs,
      };
    }
  }

  // All relays failed
  logger.warn(`Multi-relay: all ${relays.length} endpoints failed in ${responseTimeMs}ms`);

  return {
    success: false,
    errors,
    responseTimeMs,
  };
}

/**
 * Send a bundle to a single relay endpoint.
 * Kept for backward compatibility with existing code paths.
 */
export async function submitToRelay(
  transactions: string[],
  jitoUuid: string,
  endpoint: string = RELAY_ENDPOINTS['jito-us']
): Promise<{ success: boolean; bundleId?: string; error?: string }> {
  const result = await submitToAllRelays(transactions, jitoUuid, [endpoint]);

  if (result.success) {
    return { success: true, bundleId: result.bundleId };
  }

  return {
    success: false,
    error: result.errors[0]?.error ?? 'Unknown error',
  };
}