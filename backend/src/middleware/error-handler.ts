import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { logger } from '../config/logger.js';

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

const isProd = process.env.NODE_ENV === 'production';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'ValidationError',
      message: 'Invalid input',
      // Never expose field-level errors in production — attackers can probe schema shape
      details: isProd ? undefined : err.flatten().fieldErrors,
    });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({
      error: err.name,
      message: err.message,
      details: isProd ? undefined : err.details,
    });
  }
  logger.error({ err }, 'Unhandled error');
  return res.status(500).json({
    error: 'InternalError',
    message: 'Something went wrong',
  });
};
