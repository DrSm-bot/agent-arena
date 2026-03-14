import type { NextFunction, Request, Response } from "express";
import { ZodError, type AnyZodObject } from "zod";
import { AppError } from "./errors.js";

export function validateBody(schema: AnyZodObject) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      next(toValidationError(error));
    }
  };
}

export function validateParams(schema: AnyZodObject) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.params = schema.parse(req.params);
      next();
    } catch (error) {
      next(toValidationError(error));
    }
  };
}

function toValidationError(error: unknown) {
  if (error instanceof ZodError) {
    return new AppError(422, "validation_error", "Request validation failed", {
      issues: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  return error;
}
