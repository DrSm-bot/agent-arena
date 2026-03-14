import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { AppError } from "../errors.js";
import type { GameStatus } from "./game-service.js";
import { recordGameEvent } from "./game-events.js";

type GameStateRow = {
  id: string;
  game_type: string;
  status: string;
  revision: number;
  started_at: string | null;
};

type PlayerRow = {
  agent_id: string;
  player_slot: string;
  joined_at: string;
};

type ExistingMoveRow = {
  id: string;
  revision_seen: number;
  revision_applied: number;
  move_schema_version: number;
  action: string;
  params_json: string;
  reasoning: string | null;
};

type SubmitMoveInput = {
  gameId: string;
  agentId: string;
  idempotencyKey: string;
  expectedRevision: number;
  moveSchemaVersion: number;
  action: string;
  params: Record<string, unknown>;
  reasoning?: string;
};

export class MoveService {
  constructor(private readonly db: Database.Database) {}

  getState(gameId: string, agentId: string) {
    const game = this.getGame(gameId);
    const players = this.getPlayers(gameId);
    const player = players.find((entry) => entry.agent_id === agentId);

    if (!player) {
      throw new AppError(403, "not_in_game", "Agent is not a participant in this game");
    }

    return {
      game_id: game.id,
      game_type: game.game_type,
      status: game.status as GameStatus,
      revision: game.revision,
      move_schema_version: 1,
      your_role: player.player_slot,
      your_state: {
        agent_id: player.agent_id,
        joined_at: player.joined_at,
      },
      public_state: {
        started_at: game.started_at,
        players: players.map((entry) => ({
          agent_id: entry.agent_id,
          player_slot: entry.player_slot,
          joined_at: entry.joined_at,
        })),
      },
      valid_actions: game.status === "active" ? ["submit_move"] : [],
    };
  }

  submitMove(input: SubmitMoveInput) {
    const paramsJson = JSON.stringify(input.params);

    const tx = this.db.transaction(() => {
      const game = this.getGame(input.gameId);
      const player = this.db
        .prepare(
          `SELECT agent_id, player_slot, joined_at
           FROM game_players
           WHERE game_id = ? AND agent_id = ?`,
        )
        .get(input.gameId, input.agentId) as PlayerRow | undefined;

      if (!player) {
        throw new AppError(403, "not_in_game", "Agent is not a participant in this game");
      }

      const existingMove = this.db
        .prepare(
          `SELECT id, revision_seen, revision_applied, move_schema_version, action, params_json, reasoning
           FROM moves
           WHERE game_id = ? AND agent_id = ? AND idempotency_key = ?`,
        )
        .get(input.gameId, input.agentId, input.idempotencyKey) as ExistingMoveRow | undefined;

      if (existingMove) {
        if (
          existingMove.revision_seen !== input.expectedRevision ||
          existingMove.move_schema_version !== input.moveSchemaVersion ||
          existingMove.action !== input.action ||
          existingMove.params_json !== paramsJson ||
          (existingMove.reasoning ?? null) !== (input.reasoning ?? null)
        ) {
          throw new AppError(409, "idempotency_key_reused", "Idempotency key was already used for a different move");
        }

        return {
          accepted: true,
          moveId: existingMove.id,
          appliedRevision: existingMove.revision_applied,
          idempotentReplay: true,
        };
      }

      if (game.status !== "active") {
        throw new AppError(409, "game_not_accepting_moves", `Game is not accepting moves (status: ${game.status})`);
      }

      if (input.expectedRevision !== game.revision) {
        throw new AppError(409, "revision_mismatch", "Expected revision does not match current game revision", {
          current_revision: game.revision,
        });
      }

      const moveId = `mov_${crypto.randomBytes(6).toString("hex")}`;
      const now = new Date().toISOString();
      const appliedRevision = game.revision + 1;

      this.db
        .prepare(
          `INSERT INTO moves (
             id, game_id, agent_id, revision_seen, revision_applied, move_schema_version,
             action, params_json, reasoning, idempotency_key, created_at
           ) VALUES (
             @id, @game_id, @agent_id, @revision_seen, @revision_applied, @move_schema_version,
             @action, @params_json, @reasoning, @idempotency_key, @created_at
           )`,
        )
        .run({
          id: moveId,
          game_id: input.gameId,
          agent_id: input.agentId,
          revision_seen: input.expectedRevision,
          revision_applied: appliedRevision,
          move_schema_version: input.moveSchemaVersion,
          action: input.action,
          params_json: paramsJson,
          reasoning: input.reasoning ?? null,
          idempotency_key: input.idempotencyKey,
          created_at: now,
        });

      this.db.prepare("UPDATE games SET revision = ? WHERE id = ?").run(appliedRevision, input.gameId);

      recordGameEvent(this.db, {
        gameId: input.gameId,
        revision: appliedRevision,
        eventType: "move_submitted",
        actorAgentId: input.agentId,
        payload: {
          move_id: moveId,
          player_slot: player.player_slot,
          action: input.action,
          move_schema_version: input.moveSchemaVersion,
        },
        createdAt: now,
      });

      return {
        accepted: true,
        moveId,
        appliedRevision,
        idempotentReplay: false,
      };
    });

    return tx();
  }

  private getGame(gameId: string) {
    const game = this.db
      .prepare(
        `SELECT id, game_type, status, revision, started_at
         FROM games
         WHERE id = ?`,
      )
      .get(gameId) as GameStateRow | undefined;

    if (!game) {
      throw new AppError(404, "game_not_found", "Game not found");
    }

    return game;
  }

  private getPlayers(gameId: string) {
    return this.db
      .prepare(
        `SELECT agent_id, player_slot, joined_at
         FROM game_players
         WHERE game_id = ?
         ORDER BY player_slot ASC`,
      )
      .all(gameId) as PlayerRow[];
  }
}
