/**
 * Jito bundle submission module.
 *
 * Submits a 3-transaction bundle to Jito's block engine REST API.
 * Transactions must be base64-encoded, serialized, and fully signed.
 *
 * Auth: Bearer token = JITO_UUID (from env)
 * Endpoint: https://mainnet.block-engine.jito.wtf/api/v1/bundles
 */
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
export declare function submitJitoBundle(transactions: string[], jitoUuid: string): Promise<JitoSubmitResult>;
/**
 * Get current Jito tip floor (informational only, not required).
 * Returns null on failure.
 */
export declare function getJitoTipFloor(): Promise<number | null>;
//# sourceMappingURL=jito.d.ts.map