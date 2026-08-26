import type { NextFunction, Request, Response } from 'express';

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

// Wraps an async Express handler so a rejected promise reaches the error
// middleware (next(err)) instead of crashing the process. Express 4 does
// not do this automatically for async handlers.
export function asyncHandler(fn: Handler) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}
