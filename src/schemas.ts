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
