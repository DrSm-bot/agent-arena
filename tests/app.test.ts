import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

const contexts: Array<{ close: () => void }> = [];

afterEach(() => {
  while (contexts.length > 0) {
    contexts.pop()!.close();
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
