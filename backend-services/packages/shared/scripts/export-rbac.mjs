// Emit the canonical RBAC + capability registry as JSON so the Python
// execution plane can GENERATE its `nova_authz` parity module from the single
// TypeScript source of truth. Run after building the package:
//   npm run build -w @nova/shared && npm run rbac:export -w @nova/shared
// The generated JSON is committed and consumed by
// agents/orchestrator/scripts/generate_nova_authz.py; CI fails on drift.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CAPABILITY_CATALOG,
  PERMISSIONS,
  ROLES,
  ROLE_PERMISSIONS,
} from '../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, '..', 'rbac-registry.json');

const registry = {
  permissions: [...PERMISSIONS],
  roles: [...ROLES],
  rolePermissions: Object.fromEntries(
    Object.entries(ROLE_PERMISSIONS).map(([role, perms]) => [role, [...perms]]),
  ),
  capabilities: CAPABILITY_CATALOG.map((capability) => ({
    id: capability.id,
    kind: capability.kind,
    mode: capability.mode,
    requiredPermissions: [...capability.requiredPermissions],
    risk: capability.risk,
    resourceScoped: capability.resourceScoped,
    delegated: capability.delegated ?? false,
  })),
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
console.log(`Wrote RBAC registry to ${outPath}`);
