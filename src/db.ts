import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { hashInviteCode } from "./auth/api-keys.js";

export function createDatabase(databasePath: string, inviteCodes: string[]) {
  if (databasePath !== ":memory:") {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  }

  const db = new Database(databasePath);
  if (databasePath !== ":memory:") {
    db.pragma("journal_mode = WAL");
  }
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      webhook_url TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
      key_id TEXT NOT NULL UNIQUE,
      api_key_hash TEXT NOT NULL,
      scopes_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invite_codes (
      code_hash TEXT PRIMARY KEY,
      single_use INTEGER NOT NULL DEFAULT 1,
      used_by_agent_id TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      game_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'waiting',
      revision INTEGER NOT NULL DEFAULT 0,
      settings_json TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES agents(id),
      created_at TEXT NOT NULL,
      started_at TEXT
    );

    CREATE TABLE IF NOT EXISTS game_players (
      game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      player_slot TEXT NOT NULL,
      joined_at TEXT NOT NULL,
      PRIMARY KEY (game_id, agent_id)
    );

    CREATE TABLE IF NOT EXISTS game_events (
      id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      actor_agent_id TEXT REFERENCES agents(id),
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS moves (
      id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      revision_seen INTEGER NOT NULL,
      revision_applied INTEGER NOT NULL,
      move_schema_version INTEGER NOT NULL,
      action TEXT NOT NULL,
      params_json TEXT NOT NULL,
      reasoning TEXT,
      idempotency_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (game_id, agent_id, idempotency_key)
    );
  `);

  ensureGamesRevisionColumn(db);

  const insertInvite = db.prepare(`
    INSERT OR IGNORE INTO invite_codes (code_hash, single_use, used_by_agent_id, expires_at, created_at)
    VALUES (@code_hash, 1, NULL, NULL, @created_at)
  `);

  const now = new Date().toISOString();
  for (const code of inviteCodes) {
    insertInvite.run({
      code_hash: hashInviteCode(code),
      created_at: now,
    });
  }

  return db;
}

function ensureGamesRevisionColumn(db: Database.Database) {
  const columns = db
    .prepare("PRAGMA table_info(games)")
    .all() as Array<{ name: string }>;

  if (!columns.some((column) => column.name === "revision")) {
    db.exec("ALTER TABLE games ADD COLUMN revision INTEGER NOT NULL DEFAULT 0");
  }
}
