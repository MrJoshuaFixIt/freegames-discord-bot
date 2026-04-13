// src/database.js
// Manages SQLite database for tracking posted free games

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// On Railway, use /data for persistent storage if available, otherwise local
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'freegames.db');

let db;

export function initDatabase() {
  db = new Database(DB_PATH);

  // Enable WAL mode for better performance
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS posted_games (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id       TEXT NOT NULL,
      platform      TEXT NOT NULL,
      title         TEXT NOT NULL,
      url           TEXT,
      free_until    TEXT,
      first_posted  TEXT NOT NULL,
      last_posted   TEXT NOT NULL,
      UNIQUE(game_id, platform)
    );

    CREATE TABLE IF NOT EXISTS game_history (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id     TEXT NOT NULL,
      platform    TEXT NOT NULL,
      title       TEXT NOT NULL,
      posted_at   TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_game_id ON posted_games(game_id, platform);
  `);

  console.log(`[DB] Database initialized at ${DB_PATH}`);
  return db;
}

/**
 * Check if a game has been posted before.
 * Returns the existing record or null.
 */
export function getPostedGame(gameId, platform) {
  if (!db) initDatabase();
  return db.prepare(
    'SELECT * FROM posted_games WHERE game_id = ? AND platform = ?'
  ).get(gameId, platform);
}

/**
 * Mark a game as posted. If it was posted before (same game, re-listed free),
 * updates the last_posted timestamp and returns true to indicate it should be re-announced.
 * Returns: { shouldPost: boolean, isReturn: boolean }
 */
export function recordPostedGame(game) {
  if (!db) initDatabase();

  const existing = getPostedGame(game.id, game.platform);
  const now = new Date().toISOString();

  if (existing) {
    // Game was posted before — only re-post if it was previously removed and is now free again.
    // We detect "return" by checking if the stored free_until has passed.
    const prevExpiry = existing.free_until ? new Date(existing.free_until) : null;
    const isExpired = prevExpiry && prevExpiry < new Date();

    if (!isExpired) {
      // Still the same active deal — don't re-post
      return { shouldPost: false, isReturn: false };
    }

    // It's back! Update the record
    db.prepare(`
      UPDATE posted_games
      SET last_posted = ?, free_until = ?, url = ?
      WHERE game_id = ? AND platform = ?
    `).run(now, game.freeUntil || null, game.url || null, game.id, game.platform);

    db.prepare(`
      INSERT INTO game_history (game_id, platform, title, posted_at)
      VALUES (?, ?, ?, ?)
    `).run(game.id, game.platform, game.title, now);

    return { shouldPost: true, isReturn: true };
  }

  // Brand new game — insert it
  db.prepare(`
    INSERT INTO posted_games (game_id, platform, title, url, free_until, first_posted, last_posted)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(game.id, game.platform, game.title, game.url || null, game.freeUntil || null, now, now);

  db.prepare(`
    INSERT INTO game_history (game_id, platform, title, posted_at)
    VALUES (?, ?, ?, ?)
  `).run(game.id, game.platform, game.title, now);

  return { shouldPost: true, isReturn: false };
}

/**
 * Get all currently tracked games (for /listgames command)
 */
export function getAllPostedGames(limit = 50) {
  if (!db) initDatabase();
  return db.prepare(`
    SELECT * FROM posted_games
    ORDER BY last_posted DESC
    LIMIT ?
  `).all(limit);
}

/**
 * Clean up expired games from the active list (run daily)
 */
export function cleanExpiredGames() {
  if (!db) initDatabase();
  const now = new Date().toISOString();
  const result = db.prepare(`
    DELETE FROM posted_games
    WHERE free_until IS NOT NULL AND free_until < ?
  `).run(now);
  if (result.changes > 0) {
    console.log(`[DB] Cleaned ${result.changes} expired game(s)`);
  }
}

export default { initDatabase, getPostedGame, recordPostedGame, getAllPostedGames, cleanExpiredGames };
