import path from "node:path";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_PATH: z.string().default(path.join(process.cwd(), "data", "agent-arena.sqlite")),
  INVITE_CODES: z.string().default("agent-arena-dev"),
});

export type AppConfig = {
  port: number;
  databasePath: string;
  inviteCodes: string[];
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);

  return {
    port: parsed.PORT,
    databasePath: parsed.DATABASE_PATH,
    inviteCodes: parsed.INVITE_CODES.split(",")
      .map((code) => code.trim())
      .filter(Boolean),
  };
}
