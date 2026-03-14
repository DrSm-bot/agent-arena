import express from "express";
import { loadConfig, type AppConfig } from "./config.js";
import { createDatabase } from "./db.js";
import { AppError, errorEnvelope } from "./errors.js";
import { requestContext } from "./middleware/request-context.js";
import { requireAuth, requireScopes } from "./middleware/auth.js";
import { registerAgentSchema, agentIdParamsSchema } from "./schemas.js";
import { AgentService } from "./services/agent-service.js";
import { validateBody, validateParams } from "./validation.js";

export type AppContext = {
  config: AppConfig;
  agentService: AgentService;
  close: () => void;
};

export function createApp(overrides: Partial<AppConfig> = {}) {
  const config = {
    ...loadConfig(),
    ...overrides,
  };
  const db = createDatabase(config.databasePath, config.inviteCodes);
  const agentService = new AgentService(db);
  const app = express();

  app.disable("x-powered-by");
  app.use(requestContext());
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.post("/agents", validateBody(registerAgentSchema), (req, res, next) => {
    try {
      const result = agentService.createAgent({
        displayName: req.body.display_name,
        webhookUrl: req.body.webhook_url,
        inviteCode: req.body.invite_code,
      });

      res.status(201).json({
        agent_id: result.agentId,
        api_key: result.apiKey,
        scopes: result.scopes,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/agents/me", requireAuth(agentService), requireScopes(["agents:read"]), (req, res, next) => {
    try {
      res.status(200).json(agentService.getAgent(req.auth!.agentId));
    } catch (error) {
      next(error);
    }
  });

  app.post(
    "/agents/:id/rotate-key",
    requireAuth(agentService),
    requireScopes(["agents:rotate-key"]),
    validateParams(agentIdParamsSchema),
    (req, res, next) => {
      try {
        if (req.auth!.agentId !== req.params.id) {
          throw new AppError(403, "forbidden", "Agents can only rotate their own key");
        }

        const result = agentService.rotateKey(req.params.id);
        res.status(200).json({ api_key: result.apiKey });
      } catch (error) {
        next(error);
      }
    },
  );

  app.use((req, _res, next) => {
    next(new AppError(404, "not_found", "Route not found", { path: req.originalUrl }));
  });

  app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof SyntaxError && "body" in error) {
      const appError = new AppError(400, "invalid_json", "Malformed JSON body");
      res.status(appError.statusCode).json(errorEnvelope(appError, req.correlationId));
      return;
    }

    if (error instanceof AppError) {
      res.status(error.statusCode).json(errorEnvelope(error, req.correlationId));
      return;
    }

    console.error(
      JSON.stringify({
        event: "request.failed",
        correlation_id: req.correlationId,
        error,
      }),
    );
    const internalError = new AppError(500, "internal_error", "Internal server error");
    res.status(internalError.statusCode).json(errorEnvelope(internalError, req.correlationId));
  });

  const context: AppContext = {
    config,
    agentService,
    close: () => db.close(),
  };

  return { app, context };
}
