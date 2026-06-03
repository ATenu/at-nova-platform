import { Router, type RequestHandler } from 'express';
import { asyncHandler } from '../../http/async-handler';
import { RbacRegistryController } from './rbac-registry.controller';
import type { RbacRegistryService } from '../../rbac/rbac-registry.service';

export interface InternalRbacRegistryRouterDeps {
  /**
   * Service-token authenticator (audience-restricted, azp-pinned). The execution
   * plane reaches this endpoint with a service token, never a user session.
   */
  readonly serviceAuthenticate: RequestHandler;
  readonly registryService: RbacRegistryService;
}

/**
 * Internal registry endpoint for the execution plane (the orchestrator worker
 * and the A2A agents). It serves the same effective, DB-driven policy as the
 * public `/api/v1/rbac/registry` route, but is authorized by an
 * audience-restricted service token rather than a user session, because the
 * agents authenticate as services. The payload is policy structure only — never
 * user data, tokens, or PII. Agents fail closed when it is unavailable.
 */
export function createInternalRbacRegistryRouter(deps: InternalRbacRegistryRouterDeps): Router {
  const router = Router();
  const controller = new RbacRegistryController(deps.registryService);
  router.get('/registry', deps.serviceAuthenticate, asyncHandler(controller.get));
  return router;
}
