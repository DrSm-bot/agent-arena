import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { AppError } from "../errors.js";
import { recordGameEvent } from "./game-events.js";

export const SUPPORTED_GAME_TYPES = ["auction_house"] as const;
export type GameType = (typeof SUPPORTED_GAME_TYPES)[number];

export type GameStatus = "waiting" | "active" | "finished";

type GameSettings = {
  max_players: number;
  turn_timeout_sec: number;
};

type GameRow = {
  id: string;
  game_type: string;
  status: string;
  revision: number;
  settings_json: string;
  created_by: string;
  created_at: string;
  started_at: string | null;
};

type GamePlayerRow = {
  agent_id: string;
  player_slot: string;
  joined_at: string;
};

export class GameService {
  constructor(private readonly db: Database.Database) {}

  createGame(input: { agentId: string; gameType: GameType; settings: GameSettings }) {
    const gameId = `gam_${crypto.randomBytes(6).toString("hex")}`;
    const now = new Date().toISOString();

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO games (id, game_type, status, revision, settings_json, created_by, created_at)
           VALUES (@id, @game_type, 'waiting', 0, @settings_json, @created_by, @created_at)`,
        )
        .run({
          id: gameId,
          game_type: input.gameType,
          settings_json: JSON.stringify(input.settings),
          created_by: input.agentId,
          created_at: now,
        });

      this.db
        .prepare(
          `INSERT INTO game_players (game_id, agent_id, player_slot, joined_at)
           VALUES (@game_id, @agent_id, @player_slot, @joined_at)`,
        )
        .run({
          game_id: gameId,
          agent_id: input.agentId,
          player_slot: "player_1",
          joined_at: now,
        });

      recordGameEvent(this.db, {
        gameId,
        revision: 0,
        eventType: "game_created",
        actorAgentId: input.agentId,
        payload: {
          game_type: input.gameType,
          status: "waiting",
          player_slot: "player_1",
        },
        createdAt: now,
      });
    });

    tx();

    return { gameId, status: "waiting" as GameStatus, playerSlot: "player_1" };
  }

  getGame(gameId: string) {
    const game = this.db
      .prepare(
        `SELECT id, game_type, status, revision, settings_json, created_by, created_at, started_at
         FROM games WHERE id = ?`,
      )
      .get(gameId) as GameRow | undefined;

    if (!game) {
      throw new AppError(404, "game_not_found", "Game not found");
    }

    const players = this.db
      .prepare(
        `SELECT agent_id, player_slot, joined_at
         FROM game_players WHERE game_id = ?
         ORDER BY player_slot ASC`,
      )
      .all(gameId) as GamePlayerRow[];

    const settings = JSON.parse(game.settings_json) as GameSettings;

    return {
      game_id: game.id,
      game_type: game.game_type,
      status: game.status as GameStatus,
      revision: game.revision,
      settings,
      players: players.map((p) => ({
        agent_id: p.agent_id,
        player_slot: p.player_slot,
        joined_at: p.joined_at,
      })),
      created_by: game.created_by,
      created_at: game.created_at,
      started_at: game.started_at,
    };
  }

  joinGame(gameId: string, agentId: string) {
    const tx = this.db.transaction(() => {
      // All checks inside transaction to prevent race conditions
      const game = this.db
        .prepare(`SELECT id, status, revision, settings_json FROM games WHERE id = ?`)
        .get(gameId) as { id: string; status: string; revision: number; settings_json: string } | undefined;

      if (!game) {
        throw new AppError(404, "game_not_found", "Game not found");
      }

      if (game.status !== "waiting") {
        throw new AppError(409, "game_not_joinable", `Game is not accepting players (status: ${game.status})`);
      }

      const alreadyJoined = this.db
        .prepare(`SELECT agent_id FROM game_players WHERE game_id = ? AND agent_id = ?`)
        .get(gameId, agentId) as { agent_id: string } | undefined;

      if (alreadyJoined) {
        throw new AppError(409, "already_joined", "Agent has already joined this game");
      }

      const { count } = this.db
        .prepare(`SELECT COUNT(*) as count FROM game_players WHERE game_id = ?`)
        .get(gameId) as { count: number };

      const settings = JSON.parse(game.settings_json) as GameSettings;

      if (count >= settings.max_players) {
        throw new AppError(409, "game_full", "Game is full");
      }

      const playerSlot = `player_${count + 1}`;
      const now = new Date().toISOString();
      const isFull = count + 1 >= settings.max_players;
      const nextRevision = game.revision + 1;

      this.db
        .prepare(
          `INSERT INTO game_players (game_id, agent_id, player_slot, joined_at)
           VALUES (@game_id, @agent_id, @player_slot, @joined_at)`,
        )
        .run({ game_id: gameId, agent_id: agentId, player_slot: playerSlot, joined_at: now });

      this.db
        .prepare(`UPDATE games SET status = ?, started_at = ?, revision = ? WHERE id = ?`)
        .run(isFull ? "active" : "waiting", isFull ? now : null, nextRevision, gameId);

      recordGameEvent(this.db, {
        gameId,
        revision: nextRevision,
        eventType: "player_joined",
        actorAgentId: agentId,
        payload: {
          player_slot: playerSlot,
          status: isFull ? "active" : "waiting",
        },
        createdAt: now,
      });

      if (isFull) {
        recordGameEvent(this.db, {
          gameId,
          revision: nextRevision,
          eventType: "game_activated",
          actorAgentId: agentId,
          payload: {
            started_at: now,
            player_count: count + 1,
          },
          createdAt: now,
        });
      }

      return {
        gameId,
        playerSlot,
        status: (isFull ? "active" : "waiting") as GameStatus,
      };
    });

    return tx();
  }
}
