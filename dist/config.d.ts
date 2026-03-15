export interface Config {
    rpcUrl: string;
    rpcWsUrl: string;
    walletPrivateKey: string;
    jitoUuid: string;
    jitoEndpoint: string;
    jitoTipAccount: string;
    jitoTipLamports: bigint;
    jupiterApiKey: string;
    minProfitPct: number;
    minProfitUsd: number;
    tradeSizeSol: number;
    maxSlippageBps: number;
    scanIntervalMs: number;
    dryRun: boolean;
    maxTradesPerMinute: number;
    raydiumMinIntervalMs: number;
    startingCapitalUsd: number;
    tradeSizes: number[];
}
export declare function loadConfig(): Config;
export declare function validateConfig(cfg: Config): void;
//# sourceMappingURL=config.d.ts.map