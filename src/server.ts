import crypto from "node:crypto";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { z, ZodError } from "zod";
import { getDb, hashSha256, persistDb } from "./db.js";

const PORT = Number(process.env.PORT ?? 3000);

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

app.addHook("onRequest", async (req, reply) => {
  const requestId = (req.headers["x-request-id"] as string | undefined) ?? crypto.randomUUID();
  reply.header("x-request-id", requestId);
  req.log.info({ requestId, method: req.method, url: req.url }, "request_received");
});

app.setErrorHandler((error, req, reply) => {
  const requestId = reply.getHeader("x-request-id");
  if (error instanceof ZodError) {
    return reply.status(422).send({
      error: "validation_error",
      message: "Request validation failed",
      details: error.flatten(),
      request_id: requestId,
    });
  }

  const statusCode = typeof (error as { statusCode?: unknown }).statusCode === "number"
    ? (error as { statusCode: number }).statusCode
    : 500;

  return reply.status(statusCode).send({
    error: statusCode >= 500 ? "internal_error" : "request_error",
    message: error instanceof Error ? error.message : "Unexpected error",
    details: {},
    request_id: requestId,
  });
});

app.get("/health", async () => ({ ok: true }));

const createAgentSchema = z.object({
  display_name: z.string().trim().min(2).max(80),
  webhook_url: z.string().url().optional(),
  invite_code: z.string().trim().min(4),
});

const defaultScopes = ["games:join", "games:read", "moves:write", "inbox:read"];

app.post("/agents", async (req, reply) => {
  const body = createAgentSchema.parse(req.body);
  const db = await getDb();

  const inviteHash = hashSha256(body.invite_code);
  const inviteStmt = db.prepare(`SELECT code_hash, single_use, used_by_agent_id, expires_at FROM invite_codes WHERE code_hash = ?`);
  inviteStmt.bind([inviteHash]);
  const invite = inviteStmt.step() ? (inviteStmt.getAsObject() as Record<string, unknown>) : null;
  inviteStmt.free();

  if (!invite) {
    return reply.status(401).send({ error: "invalid_invite", message: "Invite code is invalid", details: {} });
  }
  if (invite.expires_at && new Date(String(invite.expires_at)).getTime() < Date.now()) {
    return reply.status(401).send({ error: "invite_expired", message: "Invite code expired", details: {} });
  }
  if (Number(invite.single_use) === 1 && invite.used_by_agent_id) {
    return reply.status(401).send({ error: "invite_used", message: "Invite code already used", details: {} });
  }

  const agentId = `agt_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const apiKey = `aa_live_${crypto.randomBytes(24).toString("hex")}`;
  const apiKeyHash = hashSha256(apiKey);
  const now = new Date().toISOString();

  db.run(
    `INSERT INTO agents (id, display_name, webhook_url, api_key_hash, scopes_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [agentId, body.display_name, body.webhook_url ?? null, apiKeyHash, JSON.stringify(defaultScopes), now, now],
  );

  db.run(
    `UPDATE invite_codes SET used_by_agent_id = ?, used_at = ? WHERE code_hash = ?`,
    [agentId, now, inviteHash],
  );

  await persistDb();

  return reply.status(201).send({ agent_id: agentId, api_key: apiKey, scopes: defaultScopes });
});

const authBearer = z.object({ authorization: z.string().startsWith("Bearer ") });

async function authenticate(req: any, reply: any) {
  const parsed = authBearer.safeParse(req.headers);
  if (!parsed.success) {
    return reply.status(401).send({ error: "unauthorized", message: "Missing bearer token", details: {} });
  }
  const token = parsed.data.authorization.slice("Bearer ".length);
  const tokenHash = hashSha256(token);
  const db = await getDb();
  const stmt = db.prepare(`SELECT id, scopes_json FROM agents WHERE api_key_hash = ?`);
  stmt.bind([tokenHash]);
  const found = stmt.step() ? (stmt.getAsObject() as Record<string, unknown>) : null;
  stmt.free();
  if (!found) {
    return reply.status(401).send({ error: "unauthorized", message: "Invalid API key", details: {} });
  }
  req.agent = {
    id: String(found.id),
    scopes: JSON.parse(String(found.scopes_json)) as string[],
  };
}

app.post("/agents/:agentId/rotate-key", { preHandler: authenticate }, async (req: any, reply) => {
  const params = z.object({ agentId: z.string() }).parse(req.params);
  if (req.agent.id !== params.agentId) {
    return reply.status(403).send({ error: "forbidden", message: "Cannot rotate key for another agent", details: {} });
  }

  const newApiKey = `aa_live_${crypto.randomBytes(24).toString("hex")}`;
  const newApiKeyHash = hashSha256(newApiKey);
  const db = await getDb();
  db.run(`UPDATE agents SET api_key_hash = ?, updated_at = ? WHERE id = ?`, [newApiKeyHash, new Date().toISOString(), params.agentId]);
  await persistDb();

  return reply.status(200).send({ api_key: newApiKey });
});

const shutdown = async () => {
  await persistDb();
  await app.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await getDb();
await app.listen({ port: PORT, host: "0.0.0.0" });
