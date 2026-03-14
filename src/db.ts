import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";

const DB_PATH = process.env.DB_PATH ?? path.resolve(process.cwd(), "data", "agent-arena.sqlite");

let SQL: SqlJsStatic | null = null;
let db: Database | null = null;

async function getSql() {
  if (SQL) return SQL;
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  SQL = await initSqlJs({
    locateFile: (file: string) =>
      path.resolve(thisDir, "..", "node_modules", "sql.js", "dist", file),
  });
  return SQL;
}

function nowIso() {
  return new Date().toISOString();
}

export async function getDb() {
  if (db) return db;
  const sql = await getSql();
  await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
  try {
    const file = await fs.readFile(DB_PATH);
    db = new sql.Database(new Uint8Array(file));
  } catch {
    db = new sql.Database();
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      webhook_url TEXT,
      api_key_hash TEXT NOT NULL,
      scopes_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invite_codes (
      code_hash TEXT PRIMARY KEY,
      single_use INTEGER NOT NULL DEFAULT 1,
      used_by_agent_id TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL,
      used_at TEXT
    );
  `);

  seedInviteCodes(db);
  await persistDb();
  return db;
}

function seedInviteCodes(database: Database) {
  const rawCodes = (process.env.INVITE_CODES ?? "DEV_INVITE").split(",").map((v) => v.trim()).filter(Boolean);
  const now = nowIso();
  for (const code of rawCodes) {
    const codeHash = hashSha256(code);
    database.run(
      `INSERT OR IGNORE INTO invite_codes (code_hash, single_use, created_at) VALUES (?, 1, ?);`,
      [codeHash, now],
    );
  }
}

export async function persistDb() {
  if (!db) return;
  const data = Buffer.from(db.export());
  await fs.writeFile(DB_PATH, data);
}

export function hashSha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
