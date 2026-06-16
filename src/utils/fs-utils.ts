/**
 * fs-utils.ts — Shared filesystem utilities for the solana-arb-bot.
 *
 * Centralises directory/file initialisation so that all scripts and modules
 * use the same pattern instead of duplicating ensureDir / mkdir logic.
 */

import * as fs from 'node:fs';

/**
 * Ensure a directory exists, creating it recursively if necessary.
 * No-op if the directory already exists.
 *
 * @param dir - Absolute or relative path to the directory.
 */
export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Ensure a file's parent directory exists, creating it recursively if needed.
 */
export function ensureParentDir(filePath: string): void {
  const dir = filePath.substring(0, filePath.lastIndexOf('/'));
  if (dir) ensureDir(dir);
}