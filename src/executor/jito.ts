/**
 * Jito bundle submission module.
 *
 * Submits a 3-transaction bundle to Jito's block engine REST API.
 * Transactions must be base64-encoded, serialized, and fully signed.
 *
 * Auth: Bearer token = JITO_UUID (from env)
 * Endpoint: https://mainnet.block-engine.jito.wtf/api/v1/bundles
 */

import axios, { AxiosError } from 'axios';
import { JitoBundleRequest, JitoBundleResponse } from '../types';
import { logger } from '../utils/logger';

const JITO_ENDPOINT = 'https://mainnet.block-engine.jito.wtf/api/v1/bundles';

export interface JitoSubmitResult {
  success: boolean;
  bundleId?: string;
  error?: string;
}

/**
 * Submit a bundle of base64-encoded transactions to Jito.
 *
 * @param transactions  Array of base64-encoded signed transactions (max 5)
 * @param jitoUuid      UUID used as Bearer token
 */
export async function submitJitoBundle(
  transactions: string[],
  jitoUuid: string
): Promise<JitoSubmitResult> {
  if (transactions.length === 0) {
    return { success: false, error: 'Empty transaction list' };
  }
  if (transactions.length > 5) {
    return { success: false, error: 'Bundle exceeds 5 transactions (Jito limit)' };
  }

  const payload: JitoBundleRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'sendBundle',
    params: [transactions],
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await axios.post<JitoBundleResponse>(JITO_ENDPOINT, payload, {
        headers: {
          'Content-Type': 'application/json',
          ...(jitoUuid ? { Authorization: `Bearer ${jitoUuid}` } : {}),
        },
        timeout: 15_000,
      });

      const data = resp.data;

      if (data.error) {
        logger.error('Jito bundle rejected', data.error);
        return {
          success: false,
          error: `Jito error ${data.error.code}: ${data.error.message}`,
        };
      }

      if (data.result) {
        logger.info(`Jito bundle accepted: ${data.result}`);
        return { success: true, bundleId: data.result };
      }

      return { success: false, error: 'Jito returned no result or error' };
    } catch (err) {
      const axiosErr = err as AxiosError;
      const status = axiosErr.response?.status;

      if (status === 429) {
        const delay = Math.pow(2, attempt) * 500;
        logger.warn(`Jito rate-limited (attempt ${attempt + 1}), retrying in ${delay}ms`);
        await sleep(delay);
        continue;
      }

      if (status === 400) {
        const body = axiosErr.response?.data as { message?: string } | undefined;
        return {
          success: false,
          error: `Jito 400: ${body?.message ?? 'Bad request'}`,
        };
      }

      logger.error(`Jito submission error (attempt ${attempt + 1})`, err);
      if (attempt === 2) {
        return {
          success: false,
          error: axiosErr.message ?? 'Unknown Jito error',
        };
      }

      await sleep(Math.pow(2, attempt) * 500);
    }
  }

  return { success: false, error: 'Exhausted Jito retries' };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Get current Jito tip floor (informational only, not required).
 * Returns null on failure.
 */
export async function getJitoTipFloor(): Promise<number | null> {
  try {
    const resp = await axios.get<{ result: { emaLandedTips50thPercentile: number } }>(
      'https://mainnet.block-engine.jito.wtf/api/v1/bundles/tip_floor',
      { timeout: 5_000 }
    );
    return resp.data?.result?.emaLandedTips50thPercentile ?? null;
  } catch {
    return null;
  }
}
