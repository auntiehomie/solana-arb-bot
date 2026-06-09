export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LEVEL_RANK: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

let currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? 'INFO';

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function timestamp(): string {
  const d = new Date();
  return (
    `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}` +
    `T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}.` +
    `${d.getUTCMilliseconds().toString().padStart(3, '0')}Z`
  );
}

const COLOURS: Record<LogLevel, string> = {
  DEBUG: '\x1b[36m',  // cyan
  INFO:  '\x1b[32m',  // green
  WARN:  '\x1b[33m',  // yellow
  ERROR: '\x1b[31m',  // red
};
const RESET = '\x1b[0m';

function emit(level: LogLevel, msg: string, data?: unknown): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[currentLevel]) return;

  const colour = COLOURS[level];
  const ts = timestamp();
  const prefix = `${colour}[${ts}] [${level.padEnd(5)}]${RESET}`;

  if (data !== undefined) {
    const extra =
      data instanceof Error
        ? ` ${data.message}${data.stack ? '\n' + data.stack : ''}`
        : ` ${JSON.stringify(data, bigIntReplacer, 2)}`;
    process.stdout.write(`${prefix} ${msg}${extra}\n`);
  } else {
    process.stdout.write(`${prefix} ${msg}\n`);
  }
}

/** JSON.stringify replacer for BigInt values */
function bigIntReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  return value;
}

export const logger = {
  debug: (msg: string, data?: unknown) => emit('DEBUG', msg, data),
  info:  (msg: string, data?: unknown) => emit('INFO',  msg, data),
  warn:  (msg: string, data?: unknown) => emit('WARN',  msg, data),
  error: (msg: string, data?: unknown) => emit('ERROR', msg, data),
};
