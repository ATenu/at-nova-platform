import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ValidationError } from '@nova/shared';
import { z, type ZodType } from 'zod';

export interface RequestSchemas {
  readonly body?: ZodType<unknown>;
  readonly query?: ZodType<unknown>;
  readonly params?: ZodType<unknown>;
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

/**
 * Runtime validation middleware for trust boundaries. Validates and narrows the
 * request body/query/params using zod schemas, replacing each part with the
 * parsed (typed, stripped) value. Every protected route should validate input.
 */
export function validateRequest(schemas: RequestSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.params) {
        req.params = schemas.params.parse(req.params) as typeof req.params;
      }
      if (schemas.query) {
        // req.query is a getter-only on newer Express; mutate in place.
        const parsed = schemas.query.parse(req.query) as Record<string, unknown>;
        Object.keys(req.query).forEach((key) => delete (req.query as Record<string, unknown>)[key]);
        Object.assign(req.query as Record<string, unknown>, parsed);
      }
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        next(new ValidationError(formatIssues(error)));
        return;
      }
      next(error);
    }
  };
}
