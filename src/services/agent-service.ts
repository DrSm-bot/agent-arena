import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { AppError } from "../errors.js";
import { generateApiKey, hashInviteCode, parseApiKey, verifySecret } from "../auth/api-keys.js";

export const DEFAULT_AGENT_SCOPES = [
  "agents:read",
  "agents:rotate-key",
  "games:join",
  "games:read",
  "moves:write",
  "inbox:read",
];

type CreateAgentInput = {
  displayName: string;
  webhookUrl?: string;
  inviteCode: string;
  scopes?: string[];
};

export class AgentService {
  constructor(private readonly db: Database.Database) {}

  createAgent(input: CreateAgentInput) {
    const invite = this.db
      .prepare(`
        SELECT code_hash, single_use, used_by_agent_id, expires_at
        FROM invite_codes
        WHERE code_hash = ?
      `)
      .get(hashInviteCode(input.inviteCode)) as
      | { code_hash: string; single_use: number; used_by_agent_id: string | null; expires_at: string | null }
      | undefined;

    if (!invite) {
      throw new AppError(403, "invalid_invite", "Invite code is invalid");
    }

    if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
      throw new AppError(403, "invalid_invite", "Invite code has expired");
    }

    if (invite.single_use && invite.used_by_agent_id) {
      throw new AppError(403, "invalid_invite", "Invite code has already been used");
    }

    const agentId = `agt_${crypto.randomBytes(6).toString("hex")}`;
    const issuedAt = new Date().toISOString();
    const apiKeyRecord = generateApiKey();
    const scopes = input.scopes ?? DEFAULT_AGENT_SCOPES;

    const tx = this.db.transaction(() => {
      this.db
        .prepare(`
          INSERT INTO agents (id, display_name, webhook_url, created_at)
          VALUES (@id, @display_name, @webhook_url, @created_at)
        `)
        .run({
          id: agentId,
          display_name: input.displayName,
          webhook_url: input.webhookUrl ?? null,
          created_at: issuedAt,
        });

      this.db
        .prepare(`
          INSERT INTO api_keys (agent_id, key_id, api_key_hash, scopes_json, updated_at)
          VALUES (@agent_id, @key_id, @api_key_hash, @scopes_json, @updated_at)
        `)
        .run({
          agent_id: agentId,
          key_id: apiKeyRecord.keyId,
          api_key_hash: apiKeyRecord.hash,
          scopes_json: JSON.stringify(scopes),
          updated_at: issuedAt,
        });

      this.db
        .prepare(`
          UPDATE invite_codes
          SET used_by_agent_id = @agent_id
          WHERE code_hash = @code_hash AND single_use = 1
        `)
        .run({
          agent_id: agentId,
          code_hash: invite.code_hash,
        });
    });

    tx();

    return {
      agentId,
      apiKey: apiKeyRecord.apiKey,
      scopes,
    };
  }

  authenticate(apiKey: string) {
    const parsed = parseApiKey(apiKey);
    const apiKeyRecord = this.db
      .prepare(`
        SELECT agent_id, key_id, api_key_hash, scopes_json
        FROM api_keys
        WHERE key_id = ?
      `)
      .get(parsed.keyId) as
      | { agent_id: string; key_id: string; api_key_hash: string; scopes_json: string }
      | undefined;

    if (!apiKeyRecord || !verifySecret(parsed.secret, apiKeyRecord.api_key_hash)) {
      throw new AppError(401, "invalid_api_key", "Invalid API key");
    }

    return {
      agentId: apiKeyRecord.agent_id,
      keyId: apiKeyRecord.key_id,
      scopes: JSON.parse(apiKeyRecord.scopes_json) as string[],
    };
  }

  rotateKey(agentId: string) {
    const agent = this.db.prepare("SELECT id FROM agents WHERE id = ?").get(agentId) as { id: string } | undefined;

    if (!agent) {
      throw new AppError(404, "agent_not_found", "Agent not found");
    }

    const apiKeyRecord = generateApiKey();
    this.db
      .prepare(`
        UPDATE api_keys
        SET key_id = @key_id, api_key_hash = @api_key_hash, updated_at = @updated_at
        WHERE agent_id = @agent_id
      `)
      .run({
        key_id: apiKeyRecord.keyId,
        api_key_hash: apiKeyRecord.hash,
        updated_at: new Date().toISOString(),
        agent_id: agentId,
      });

    return {
      apiKey: apiKeyRecord.apiKey,
    };
  }

  getAgent(agentId: string) {
    const row = this.db
      .prepare(`
        SELECT a.id, a.display_name, a.webhook_url, a.created_at, k.scopes_json
        FROM agents a
        JOIN api_keys k ON k.agent_id = a.id
        WHERE a.id = ?
      `)
      .get(agentId) as
      | {
          id: string;
          display_name: string;
          webhook_url: string | null;
          created_at: string;
          scopes_json: string;
        }
      | undefined;

    if (!row) {
      throw new AppError(404, "agent_not_found", "Agent not found");
    }

    return {
      agent_id: row.id,
      display_name: row.display_name,
      webhook_url: row.webhook_url,
      created_at: row.created_at,
      scopes: JSON.parse(row.scopes_json) as string[],
    };
  }

  getApiKeyHash(agentId: string) {
    const row = this.db
      .prepare("SELECT api_key_hash FROM api_keys WHERE agent_id = ?")
      .get(agentId) as { api_key_hash: string } | undefined;

    return row?.api_key_hash ?? null;
  }
}
