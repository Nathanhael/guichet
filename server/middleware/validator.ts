import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';

/**
 * Express middleware that validates req.body against a Zod schema.
 * Returns 400 with an errors array on failure (same shape as the old
 * express-validator response so existing clients stay compatible).
 */
export const validateBody = <T extends z.ZodTypeAny>(schema: T) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (result.success) {
      req.body = result.data;
      return next();
    }
    const errors = result.error.issues.map((issue) => ({
      type: 'field',
      msg: issue.message,
      path: issue.path.join('.'),
      location: 'body',
    }));
    res.status(400).json({ errors });
  };
};

/**
 * Express middleware that validates req.query against a Zod schema.
 * Returns 400 with an errors array on failure.
 */
export const validateQuery = <T extends z.ZodTypeAny>(schema: T) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (result.success) {
      // Attach parsed values so downstream handlers see coerced types.
      // Express 5 may make req.query read-only, so use Object.defineProperty as fallback.
      try {
        (req as unknown as Record<string, unknown>).query = result.data;
      } catch {
        Object.defineProperty(req, 'query', { value: result.data, writable: true, configurable: true });
      }
      return next();
    }
    const errors = result.error.issues.map((issue) => ({
      type: 'field',
      msg: issue.message,
      path: issue.path.join('.'),
      location: 'query',
    }));
    res.status(400).json({ errors });
  };
};
