import Database from 'better-sqlite3';
import { config } from '../config.js';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

// Ensure data directory exists
const dataDir = dirname(config.dbPath);
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

const db = new Database(config.dbPath);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    pair TEXT NOT NULL,
    buy_exchange TEXT NOT NULL,
    sell_exchange TEXT NOT NULL,
    buy_price REAL NOT NULL,
    sell_price REAL NOT NULL,
    amount REAL NOT NULL,
    profit_usd REAL NOT NULL,
    profit_percent REAL NOT NULL,
    simulated BOOLEAN DEFAULT 1,
    executed BOOLEAN DEFAULT 0,
    notes TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_timestamp ON trades(timestamp);
  CREATE INDEX IF NOT EXISTS idx_pair ON trades(pair);
  CREATE INDEX IF NOT EXISTS idx_executed ON trades(executed);

  CREATE TABLE IF NOT EXISTS balance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    balance_usd REAL NOT NULL,
    total_trades INTEGER DEFAULT 0,
    winning_trades INTEGER DEFAULT 0,
    total_profit REAL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_balance_timestamp ON balance(timestamp);

  CREATE TABLE IF NOT EXISTS opportunities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    pair TEXT NOT NULL,
    buy_exchange TEXT NOT NULL,
    sell_exchange TEXT NOT NULL,
    profit_percent REAL NOT NULL,
    price_buy REAL NOT NULL,
    price_sell REAL NOT NULL,
    taken BOOLEAN DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_opp_timestamp ON opportunities(timestamp);

  -- Initialize starting balance if not exists
  INSERT INTO balance (timestamp, balance_usd, total_trades, winning_trades, total_profit)
  SELECT ${Date.now()}, ${config.startingCapital}, 0, 0, 0
  WHERE NOT EXISTS (SELECT 1 FROM balance LIMIT 1);
`);

console.log('Database initialized at:', config.dbPath);

export default db;
