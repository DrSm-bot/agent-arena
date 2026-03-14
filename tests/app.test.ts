import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

const contexts: Array<{ close: () => void }> = [];

afterEach(() => {
  while (contexts.length > 0) {
    contexts.pop()?.close();
  }
});

function buildTestApp() {
  const instance = createApp({
    databasePath: ":memory:",
    inviteCodes: ["valid-invite", "valid-invite-2"],
    port: 0,
  });
  contexts.push(instance.context);
  return instance;
}

describe("Agent Arena API", () => {
  it("returns health status", async () => {
    const { app } = buildTestApp();

    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
    expect(response.headers["x-correlation-id"]).toBeTruthy();
  });

  it("registers an agent with a valid invite and authenticates with bearer key", async () => {
    const { app, context } = buildTestApp();

    const registerResponse = await request(app).post("/agents").send({
      display_name: "Codex",
      invite_code: "valid-invite",
    });

    expect(registerResponse.status).toBe(201);
    expect(registerResponse.body.agent_id).toMatch(/^agt_/);
    expect(registerResponse.body.api_key).toMatch(/^aa_/);
    expect(registerResponse.body.scopes).toContain("agents:read");

    const meResponse = await request(app)
      .get("/agents/me")
      .set("Authorization", `Bearer ${registerResponse.body.api_key}`);

    expect(meResponse.status).toBe(200);
    expect(meResponse.body.agent_id).toBe(registerResponse.body.agent_id);

    const storedHash = context.agentService.getApiKeyHash(registerResponse.body.agent_id);
    expect(storedHash).toBeTruthy();
    expect(storedHash).not.toContain(registerResponse.body.api_key);
  });

  it("rejects invalid invite codes", async () => {
    const { app } = buildTestApp();

    const response = await request(app).post("/agents").send({
      display_name: "Codex",
      invite_code: "bad-invite",
    });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("invalid_invite");
  });

  it("returns 401 for an invalid api key", async () => {
    const { app } = buildTestApp();

    const response = await request(app).get("/agents/me").set("Authorization", "Bearer aa_bad_bad");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("invalid_api_key");
  });

  it("returns 403 when the key is missing the required scope", async () => {
    const { app, context } = buildTestApp();
    const limitedAgent = context.agentService.createAgent({
      displayName: "Scope Tester",
      inviteCode: "valid-invite-2",
      scopes: ["games:read"],
    });

    const response = await request(app)
      .get("/agents/me")
      .set("Authorization", `Bearer ${limitedAgent.apiKey}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("insufficient_scope");
  });

  describe("Game lifecycle", () => {
    async function buildAgentWithKey(app: ReturnType<typeof buildTestApp>["app"], inviteCode: string) {
      const res = await request(app).post("/agents").send({ display_name: "TestAgent", invite_code: inviteCode });
      return { agentId: res.body.agent_id as string, apiKey: res.body.api_key as string };
    }

    it("creates a game and creator becomes player_1", async () => {
      const { app } = buildTestApp();
      const { apiKey } = await buildAgentWithKey(app, "valid-invite");

      const res = await request(app)
        .post("/games")
        .set("Authorization", `Bearer ${apiKey}`)
        .send({ game_type: "auction_house", settings: { max_players: 2 } });

      expect(res.status).toBe(201);
      expect(res.body.game_id).toMatch(/^gam_/);
      expect(res.body.status).toBe("waiting");
      expect(res.body.player_slot).toBe("player_1");
    });

    it("GET /games/:id returns game state with player list", async () => {
      const { app } = buildTestApp();
      const { apiKey, agentId } = await buildAgentWithKey(app, "valid-invite");

      const createRes = await request(app)
        .post("/games")
        .set("Authorization", `Bearer ${apiKey}`)
        .send({ game_type: "auction_house", settings: { max_players: 2 } });

      const gameId = createRes.body.game_id as string;
      const stateRes = await request(app)
        .get(`/games/${gameId}`)
        .set("Authorization", `Bearer ${apiKey}`);

      expect(stateRes.status).toBe(200);
      expect(stateRes.body.game_id).toBe(gameId);
      expect(stateRes.body.status).toBe("waiting");
      expect(stateRes.body.game_type).toBe("auction_house");
      expect(stateRes.body.revision).toBe(0);
      expect(stateRes.body.players).toHaveLength(1);
      expect(stateRes.body.players[0].agent_id).toBe(agentId);
      expect(stateRes.body.players[0].player_slot).toBe("player_1");
    });

    it("second agent joins and game transitions to active", async () => {
      const { app } = buildTestApp();
      const agent1 = await buildAgentWithKey(app, "valid-invite");
      const agent2 = await buildAgentWithKey(app, "valid-invite-2");

      const createRes = await request(app)
        .post("/games")
        .set("Authorization", `Bearer ${agent1.apiKey}`)
        .send({ game_type: "auction_house", settings: { max_players: 2 } });

      const gameId = createRes.body.game_id as string;

      const joinRes = await request(app)
        .post(`/games/${gameId}/join`)
        .set("Authorization", `Bearer ${agent2.apiKey}`);

      expect(joinRes.status).toBe(200);
      expect(joinRes.body.player_slot).toBe("player_2");
      expect(joinRes.body.status).toBe("active");

      const stateRes = await request(app)
        .get(`/games/${gameId}`)
        .set("Authorization", `Bearer ${agent1.apiKey}`);

      expect(stateRes.body.status).toBe("active");
      expect(stateRes.body.revision).toBe(1);
      expect(stateRes.body.players).toHaveLength(2);
      expect(stateRes.body.started_at).toBeTruthy();
    });

    it("rejects joining a game that is already active", async () => {
      const { app } = buildTestApp();
      const agent1 = await buildAgentWithKey(app, "valid-invite");
      const agent2 = await buildAgentWithKey(app, "valid-invite-2");

      const createRes = await request(app)
        .post("/games")
        .set("Authorization", `Bearer ${agent1.apiKey}`)
        .send({ game_type: "auction_house", settings: { max_players: 2 } });

      const gameId = createRes.body.game_id as string;

      // agent2 fills the last slot, game becomes active
      await request(app)
        .post(`/games/${gameId}/join`)
        .set("Authorization", `Bearer ${agent2.apiKey}`);

      // agent1 tries to join again — fails on status check (active), not duplicate check
      const lateJoinRes = await request(app)
        .post(`/games/${gameId}/join`)
        .set("Authorization", `Bearer ${agent1.apiKey}`);

      expect(lateJoinRes.status).toBe(409);
      expect(lateJoinRes.body.error.code).toBe("game_not_joinable");
    });

    it("rejects joining the same game twice", async () => {
      const { app } = buildTestApp();
      const agent1 = await buildAgentWithKey(app, "valid-invite");

      const createRes = await request(app)
        .post("/games")
        .set("Authorization", `Bearer ${agent1.apiKey}`)
        .send({ game_type: "auction_house", settings: { max_players: 3 } });

      const gameId = createRes.body.game_id as string;

      const res = await request(app)
        .post(`/games/${gameId}/join`)
        .set("Authorization", `Bearer ${agent1.apiKey}`);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("already_joined");
    });

    it("returns 404 for a non-existent game", async () => {
      const { app } = buildTestApp();
      const { apiKey } = await buildAgentWithKey(app, "valid-invite");

      const res = await request(app)
        .get("/games/gam_000000000000")
        .set("Authorization", `Bearer ${apiKey}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("game_not_found");
    });

    it("GET /games/:id/state returns an agent-facing projection", async () => {
      const { app } = buildTestApp();
      const agent1 = await buildAgentWithKey(app, "valid-invite");
      const agent2 = await buildAgentWithKey(app, "valid-invite-2");

      const createRes = await request(app)
        .post("/games")
        .set("Authorization", `Bearer ${agent1.apiKey}`)
        .send({ game_type: "auction_house", settings: { max_players: 2 } });

      const gameId = createRes.body.game_id as string;

      await request(app)
        .post(`/games/${gameId}/join`)
        .set("Authorization", `Bearer ${agent2.apiKey}`);

      const stateRes = await request(app)
        .get(`/games/${gameId}/state`)
        .set("Authorization", `Bearer ${agent2.apiKey}`);

      expect(stateRes.status).toBe(200);
      expect(stateRes.body.game_id).toBe(gameId);
      expect(stateRes.body.revision).toBe(1);
      expect(stateRes.body.your_role).toBe("player_2");
      expect(stateRes.body.public_state.players).toHaveLength(2);
      expect(stateRes.body.valid_actions).toEqual(["submit_move"]);
    });

    it("rejects GET /games/:id/state for a non-participant", async () => {
      const { app } = buildTestApp();
      const agent1 = await buildAgentWithKey(app, "valid-invite");
      const outsider = await buildAgentWithKey(app, "valid-invite-2");

      const createRes = await request(app)
        .post("/games")
        .set("Authorization", `Bearer ${agent1.apiKey}`)
        .send({ game_type: "auction_house", settings: { max_players: 2 } });

      const res = await request(app)
        .get(`/games/${createRes.body.game_id as string}/state`)
        .set("Authorization", `Bearer ${outsider.apiKey}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("not_in_game");
    });

    it("accepts a move with revision and idempotency handling", async () => {
      const { app } = buildTestApp();
      const agent1 = await buildAgentWithKey(app, "valid-invite");
      const agent2 = await buildAgentWithKey(app, "valid-invite-2");

      const createRes = await request(app)
        .post("/games")
        .set("Authorization", `Bearer ${agent1.apiKey}`)
        .send({ game_type: "auction_house", settings: { max_players: 2 } });

      const gameId = createRes.body.game_id as string;

      await request(app)
        .post(`/games/${gameId}/join`)
        .set("Authorization", `Bearer ${agent2.apiKey}`);

      const firstMove = await request(app)
        .post(`/games/${gameId}/moves`)
        .set("Authorization", `Bearer ${agent1.apiKey}`)
        .set("Idempotency-Key", "move-1")
        .send({
          expected_revision: 1,
          move_schema_version: 1,
          action: "bid",
          params: { amount: 200 },
        });

      expect(firstMove.status).toBe(202);
      expect(firstMove.body.accepted).toBe(true);
      expect(firstMove.body.applied_revision).toBe(2);
      expect(firstMove.body.idempotent_replay).toBe(false);

      const replayMove = await request(app)
        .post(`/games/${gameId}/moves`)
        .set("Authorization", `Bearer ${agent1.apiKey}`)
        .set("Idempotency-Key", "move-1")
        .send({
          expected_revision: 1,
          move_schema_version: 1,
          action: "bid",
          params: { amount: 200 },
        });

      expect(replayMove.status).toBe(200);
      expect(replayMove.body.move_id).toBe(firstMove.body.move_id);
      expect(replayMove.body.applied_revision).toBe(2);
      expect(replayMove.body.idempotent_replay).toBe(true);

      const stateRes = await request(app)
        .get(`/games/${gameId}/state`)
        .set("Authorization", `Bearer ${agent2.apiKey}`);

      expect(stateRes.body.revision).toBe(2);
    });

    it("rejects stale move revisions predictably", async () => {
      const { app } = buildTestApp();
      const agent1 = await buildAgentWithKey(app, "valid-invite");
      const agent2 = await buildAgentWithKey(app, "valid-invite-2");

      const createRes = await request(app)
        .post("/games")
        .set("Authorization", `Bearer ${agent1.apiKey}`)
        .send({ game_type: "auction_house", settings: { max_players: 2 } });

      const gameId = createRes.body.game_id as string;

      await request(app)
        .post(`/games/${gameId}/join`)
        .set("Authorization", `Bearer ${agent2.apiKey}`);

      await request(app)
        .post(`/games/${gameId}/moves`)
        .set("Authorization", `Bearer ${agent1.apiKey}`)
        .set("Idempotency-Key", "move-1")
        .send({
          expected_revision: 1,
          move_schema_version: 1,
          action: "bid",
          params: { amount: 200 },
        });

      const staleMove = await request(app)
        .post(`/games/${gameId}/moves`)
        .set("Authorization", `Bearer ${agent2.apiKey}`)
        .set("Idempotency-Key", "move-2")
        .send({
          expected_revision: 1,
          move_schema_version: 1,
          action: "pass",
          params: {},
        });

      expect(staleMove.status).toBe(409);
      expect(staleMove.body.error.code).toBe("revision_mismatch");
      expect(staleMove.body.error.details.current_revision).toBe(2);
    });

    it("requires Idempotency-Key for move submission", async () => {
      const { app } = buildTestApp();
      const agent1 = await buildAgentWithKey(app, "valid-invite");
      const agent2 = await buildAgentWithKey(app, "valid-invite-2");

      const createRes = await request(app)
        .post("/games")
        .set("Authorization", `Bearer ${agent1.apiKey}`)
        .send({ game_type: "auction_house", settings: { max_players: 2 } });

      const gameId = createRes.body.game_id as string;

      await request(app)
        .post(`/games/${gameId}/join`)
        .set("Authorization", `Bearer ${agent2.apiKey}`);

      const res = await request(app)
        .post(`/games/${gameId}/moves`)
        .set("Authorization", `Bearer ${agent1.apiKey}`)
        .send({
          expected_revision: 1,
          move_schema_version: 1,
          action: "bid",
          params: { amount: 200 },
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("missing_idempotency_key");
    });
  });

  it("rotates an agent key and invalidates the old key", async () => {
    const { app } = buildTestApp();

    const registerResponse = await request(app).post("/agents").send({
      display_name: "Codex",
      invite_code: "valid-invite",
    });

    const rotateResponse = await request(app)
      .post(`/agents/${registerResponse.body.agent_id}/rotate-key`)
      .set("Authorization", `Bearer ${registerResponse.body.api_key}`);

    expect(rotateResponse.status).toBe(200);
    expect(rotateResponse.body.api_key).toMatch(/^aa_/);
    expect(rotateResponse.body.api_key).not.toBe(registerResponse.body.api_key);

    const oldKeyResponse = await request(app)
      .get("/agents/me")
      .set("Authorization", `Bearer ${registerResponse.body.api_key}`);

    const newKeyResponse = await request(app)
      .get("/agents/me")
      .set("Authorization", `Bearer ${rotateResponse.body.api_key}`);

    expect(oldKeyResponse.status).toBe(401);
    expect(newKeyResponse.status).toBe(200);
  });
});
