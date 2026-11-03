import { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";
import { normalizeDatabaseError } from "../../lib/db/errors";

export const notFoundHandler = (
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  res.status(404).json({
    success: false,
    error: `Resource not found: ${req.method} ${req.originalUrl}`,
  });
};

/**
 * Central error handler.
 * Maps database-layer failures to safe status codes/messages (503 for an
 * unavailable database, 409 for constraint violations, 500 otherwise) without
 * leaking SQL, connection strings, or stack traces in production.
 */
export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const { statusCode, message, code } = normalizeDatabaseError(err, "Internal Server Error");

  logger.error(`Unhandled Backend Error [${code}]:`, err.stack || err.message);

  res.status(statusCode).json({
    success: false,
    error: message,
    ...(process.env.NODE_ENV === "production" ? {} : { detail: err.message }),
  });
};

