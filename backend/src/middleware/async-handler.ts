import type { RequestHandler, Request, Response, NextFunction } from 'express';

/**
 * Wraps an async Express route handler so that any thrown error or rejected
 * promise is forwarded to Express's error middleware via next(err).
 *
 * Express 4 does not do this automatically — without this wrapper, an async
 * handler that throws causes an unhandledRejection and the request hangs.
 */
export function asyncHandler(fn: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
