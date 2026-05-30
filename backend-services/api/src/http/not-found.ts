import type { RequestHandler } from 'express';
import { NotFoundError } from '@nova/shared';

/** Terminal handler for unmatched routes. Forwards a typed 404 to the error handler. */
export function notFoundHandler(): RequestHandler {
  return (_req, _res, next) => {
    next(new NotFoundError('The requested endpoint does not exist.'));
  };
}
