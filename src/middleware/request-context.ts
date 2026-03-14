import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export function requestContext() {
  return (req: Request, res: Response, next: NextFunction) => {
    req.correlationId = req.header("x-correlation-id") ?? crypto.randomUUID();
    res.setHeader("x-correlation-id", req.correlationId);

    const startedAt = Date.now();
    console.info(
      JSON.stringify({
        event: "request.started",
        correlation_id: req.correlationId,
        method: req.method,
        path: req.originalUrl,
      }),
    );

    res.on("finish", () => {
      console.info(
        JSON.stringify({
          event: "request.completed",
          correlation_id: req.correlationId,
          method: req.method,
          path: req.originalUrl,
          status_code: res.statusCode,
          duration_ms: Date.now() - startedAt,
        }),
      );
    });

    next();
  };
}
