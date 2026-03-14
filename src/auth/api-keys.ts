import crypto from "node:crypto";
import { AppError } from "../errors.js";

export type AuthContext = {
  agentId: string;
  scopes: string[];
  keyId: string;
};

const API_KEY_PREFIX = "aa";

export function generateApiKey() {
  const keyId = crypto.randomBytes(6).toString("hex");
  const secret = crypto.randomBytes(24).toString("base64url");
  const apiKey = `${API_KEY_PREFIX}_${keyId}_${secret}`;

  return {
    apiKey,
    keyId,
    hash: hashSecret(secret),
  };
}

export function parseApiKey(apiKey: string) {
  const match = /^aa_([a-f0-9]{12})_([A-Za-z0-9_-]+)$/.exec(apiKey);

  if (!match) {
    throw new AppError(401, "invalid_api_key", "Invalid API key");
  }

  return {
    keyId: match[1],
    secret: match[2],
  };
}

export function hashInviteCode(code: string) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

export function hashSecret(secret: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = crypto.scryptSync(secret, salt, 64).toString("hex");

  return `scrypt$${salt}$${derivedKey}`;
}

export function verifySecret(secret: string, storedHash: string) {
  const [algorithm, salt, expected] = storedHash.split("$");

  if (algorithm !== "scrypt" || !salt || !expected) {
    return false;
  }

  const derivedKey = crypto.scryptSync(secret, salt, 64).toString("hex");

  return crypto.timingSafeEqual(Buffer.from(derivedKey, "hex"), Buffer.from(expected, "hex"));
}
