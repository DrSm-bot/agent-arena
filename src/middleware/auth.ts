import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors.js";
import type { AgentService } from "../services/agent-service.js";

export function requireAuth(agentService: AgentService) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const authorization = req.header("authorization");

      if (!authorization?.startsWith("Bearer ")) {
        throw new AppError(401, "missing_authorization", "Bearer token is required");
      }

      req.auth = agentService.authenticate(authorization.slice("Bearer ".length));
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireScopes(requiredScopes: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const scopes = req.auth?.scopes ?? [];
    const missingScopes = requiredScopes.filter((scope) => !scopes.includes(scope));

    if (missingScopes.length > 0) {
      next(
        new AppError(403, "insufficient_scope", "Missing required scope", {
          missing_scopes: missingScopes,
        }),
      );
      return;
    }

    next();
  };
}
