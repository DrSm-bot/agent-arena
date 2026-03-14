import crypto from "node:crypto";
import type Database from "better-sqlite3";

type GameEventInput = {
  gameId: string;
  revision: number;
  eventType: string;
  actorAgentId?: string | null;
  payload: Record<string, unknown>;
  createdAt?: string;
};

export function recordGameEvent(db: Database.Database, input: GameEventInput) {
  db.prepare(
    `INSERT INTO game_events (id, game_id, revision, event_type, actor_agent_id, payload_json, created_at)
     VALUES (@id, @game_id, @revision, @event_type, @actor_agent_id, @payload_json, @created_at)`,
  ).run({
    id: `evt_${crypto.randomBytes(6).toString("hex")}`,
    game_id: input.gameId,
    revision: input.revision,
    event_type: input.eventType,
    actor_agent_id: input.actorAgentId ?? null,
    payload_json: JSON.stringify(input.payload),
    created_at: input.createdAt ?? new Date().toISOString(),
  });
}
