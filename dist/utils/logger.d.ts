export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
export declare function setLogLevel(level: LogLevel): void;
export declare const logger: {
    debug: (msg: string, data?: unknown) => void;
    info: (msg: string, data?: unknown) => void;
    warn: (msg: string, data?: unknown) => void;
    error: (msg: string, data?: unknown) => void;
};
//# sourceMappingURL=logger.d.ts.map