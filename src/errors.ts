export type ErrorDetails = Record<string, unknown> | undefined;

export class AppError extends Error {
  statusCode: number;
  code: string;
  details?: ErrorDetails;

  constructor(statusCode: number, code: string, message: string, details?: ErrorDetails) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function errorEnvelope(error: AppError, correlationId: string) {
  return {
    error: {
      code: error.code,
      message: error.message,
      details: error.details ?? {},
    },
    correlation_id: correlationId,
  };
}
