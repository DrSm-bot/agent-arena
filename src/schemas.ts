import { z } from "zod";

export const registerAgentSchema = z.object({
  display_name: z.string().trim().min(1).max(80),
  webhook_url: z.string().url().optional(),
  invite_code: z.string().trim().min(1),
});

export const agentIdParamsSchema = z.object({
  id: z.string().regex(/^agt_[a-z0-9]+$/),
});
