import { RbacRegistry } from './rbac-registry';

/**
 * Process-wide holder for the active RBAC registry. The enforcement layer
 * (authentication context, authorization middleware, DTO mappers, entitlement
 * snapshots) reads policy through this holder so a single in-memory snapshot is
 * shared without threading it through every call site. It mirrors the existing
 * module-level route-policy registry pattern.
 *
 * The default is the static catalog: a safe, deny-by-default baseline identical
 * to the seeded database, used before the first DB load and in unit tests. The
 * `RbacRegistryService` replaces it on boot and on every refresh.
 */
let active: RbacRegistry = RbacRegistry.fromStaticCatalog();

export function getActiveRegistry(): RbacRegistry {
  return active;
}

export function setActiveRegistry(registry: RbacRegistry): void {
  active = registry;
}

/** Reset to the static baseline. Intended for test isolation. */
export function resetActiveRegistry(): void {
  active = RbacRegistry.fromStaticCatalog();
}
