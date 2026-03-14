import { z } from "zod";

export const registerAgentSchema = z.object({
  display_name: z.string().trim().min(1).max(80),
  webhook_url: z.string().url().optional(),
  invite_code: z.string().trim().min(1),
});

export const agentIdParamsSchema = z.object({
  id: z.string().regex(/^agt_[a-z0-9]+$/),
});

export const createGameSchema = z.object({
  game_type: z.enum(["auction_house"]),
  settings: z
    .object({
      max_players: z.number().int().min(2).max(8).default(2),
      turn_timeout_sec: z.number().int().min(60).max(86400).default(3600),
    })
    .default({}),
});

export const gameIdParamsSchema = z.object({
  id: z.string().regex(/^gam_[a-z0-9]+$/),
});

export const submitMoveSchema = z.object({
  expected_revision: z.number().int().min(0),
  move_schema_version: z.literal(1),
  action: z.string().trim().min(1).max(64),
  params: z.record(z.string(), z.unknown()).default({}),
  reasoning: z.string().trim().max(4000).optional(),
});
