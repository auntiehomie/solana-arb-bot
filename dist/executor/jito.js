"use strict";
/**
 * Jito bundle submission module.
 *
 * Submits a 3-transaction bundle to Jito's block engine REST API.
 * Transactions must be base64-encoded, serialized, and fully signed.
 *
 * Auth: Bearer token = JITO_UUID (from env)
 * Endpoint: https://mainnet.block-engine.jito.wtf/api/v1/bundles
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.submitJitoBundle = submitJitoBundle;
exports.getJitoTipFloor = getJitoTipFloor;
const axios_1 = __importDefault(require("axios"));
const logger_1 = require("../utils/logger");
const JITO_ENDPOINT = 'https://mainnet.block-engine.jito.wtf/api/v1/bundles';
/**
 * Submit a bundle of base64-encoded transactions to Jito.
 *
 * @param transactions  Array of base64-encoded signed transactions (max 5)
 * @param jitoUuid      UUID used as Bearer token
 */
async function submitJitoBundle(transactions, jitoUuid) {
    if (transactions.length === 0) {
        return { success: false, error: 'Empty transaction list' };
    }
    if (transactions.length > 5) {
        return { success: false, error: 'Bundle exceeds 5 transactions (Jito limit)' };
    }
    const payload = {
        jsonrpc: '2.0',
        id: 1,
        method: 'sendBundle',
        params: [transactions],
    };
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const resp = await axios_1.default.post(JITO_ENDPOINT, payload, {
                headers: {
                    'Content-Type': 'application/json',
                    ...(jitoUuid ? { Authorization: `Bearer ${jitoUuid}` } : {}),
                },
                timeout: 15_000,
            });
            const data = resp.data;
            if (data.error) {
                logger_1.logger.error('Jito bundle rejected', data.error);
                return {
                    success: false,
                    error: `Jito error ${data.error.code}: ${data.error.message}`,
                };
            }
            if (data.result) {
                logger_1.logger.info(`Jito bundle accepted: ${data.result}`);
                return { success: true, bundleId: data.result };
            }
            return { success: false, error: 'Jito returned no result or error' };
        }
        catch (err) {
            const axiosErr = err;
            const status = axiosErr.response?.status;
            if (status === 429) {
                const delay = Math.pow(2, attempt) * 500;
                logger_1.logger.warn(`Jito rate-limited (attempt ${attempt + 1}), retrying in ${delay}ms`);
                await sleep(delay);
                continue;
            }
            if (status === 400) {
                const body = axiosErr.response?.data;
                return {
                    success: false,
                    error: `Jito 400: ${body?.message ?? 'Bad request'}`,
                };
            }
            logger_1.logger.error(`Jito submission error (attempt ${attempt + 1})`, err);
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
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
/**
 * Get current Jito tip floor (informational only, not required).
 * Returns null on failure.
 */
async function getJitoTipFloor() {
    try {
        const resp = await axios_1.default.get('https://mainnet.block-engine.jito.wtf/api/v1/bundles/tip_floor', { timeout: 5_000 });
        return resp.data?.result?.emaLandedTips50thPercentile ?? null;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=jito.js.map