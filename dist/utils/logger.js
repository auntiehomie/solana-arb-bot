"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
exports.setLogLevel = setLogLevel;
const LEVEL_RANK = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
};
let currentLevel = process.env.LOG_LEVEL ?? 'INFO';
function setLogLevel(level) {
    currentLevel = level;
}
function pad2(n) {
    return n.toString().padStart(2, '0');
}
function timestamp() {
    const d = new Date();
    return (`${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}` +
        `T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}.` +
        `${d.getUTCMilliseconds().toString().padStart(3, '0')}Z`);
}
const COLOURS = {
    DEBUG: '\x1b[36m', // cyan
    INFO: '\x1b[32m', // green
    WARN: '\x1b[33m', // yellow
    ERROR: '\x1b[31m', // red
};
const RESET = '\x1b[0m';
function emit(level, msg, data) {
    if (LEVEL_RANK[level] < LEVEL_RANK[currentLevel])
        return;
    const colour = COLOURS[level];
    const ts = timestamp();
    const prefix = `${colour}[${ts}] [${level.padEnd(5)}]${RESET}`;
    if (data !== undefined) {
        const extra = data instanceof Error
            ? ` ${data.message}${data.stack ? '\n' + data.stack : ''}`
            : ` ${JSON.stringify(data, bigIntReplacer, 2)}`;
        process.stdout.write(`${prefix} ${msg}${extra}\n`);
    }
    else {
        process.stdout.write(`${prefix} ${msg}\n`);
    }
}
/** JSON.stringify replacer for BigInt values */
function bigIntReplacer(_key, value) {
    if (typeof value === 'bigint')
        return value.toString();
    return value;
}
exports.logger = {
    debug: (msg, data) => emit('DEBUG', msg, data),
    info: (msg, data) => emit('INFO', msg, data),
    warn: (msg, data) => emit('WARN', msg, data),
    error: (msg, data) => emit('ERROR', msg, data),
};
//# sourceMappingURL=logger.js.map