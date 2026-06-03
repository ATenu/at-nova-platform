import type { Request, Response } from 'express';
import type { RbacRegistryService } from '../../rbac/rbac-registry.service';

/**
 * Serves the effective, DB-driven authorization policy to authenticated clients
 * (the React frontend and the Python agents). The response is keyed by the
 * monotonic revision via a weak ETag so clients can cheaply revalidate with
 * `If-None-Match` and receive `304 Not Modified` while the policy is unchanged.
 * The payload is policy structure only — never user data, tokens, or PII.
 */
export class RbacRegistryController {
  constructor(private readonly registry: RbacRegistryService) {}

  get = (req: Request, res: Response): Promise<void> => {
    const snapshot = this.registry.getCurrent().snapshot;
    const etag = `W/"rbac-${snapshot.revision}"`;
    res.setHeader('ETag', etag);
    // Always revalidate; the ETag makes a no-change revalidation cheap (304).
    res.setHeader('Cache-Control', 'private, no-cache');

    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
    } else {
      res.json(snapshot);
    }
    return Promise.resolve();
  };
}
