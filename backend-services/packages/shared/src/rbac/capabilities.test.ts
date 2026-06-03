import {
  CAPABILITY_CATALOG,
  capabilitiesForPermissions,
  capabilityRequiresApproval,
  getCapability,
  permissionsSatisfyCapability,
  rolesGrantCapability,
} from './capabilities';
import { PERMISSIONS, permissionsForRoles, type Permission } from './permissions';

describe('capability catalog', () => {
  it('only references defined domain permissions', () => {
    const known = new Set<string>(PERMISSIONS);
    for (const capability of CAPABILITY_CATALOG) {
      expect(capability.requiredPermissions.length).toBeGreaterThan(0);
      for (const permission of capability.requiredPermissions) {
        expect(known.has(permission)).toBe(true);
      }
    }
  });

  it('has unique capability ids', () => {
    const ids = CAPABILITY_CATALOG.map((capability) => capability.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('getCapability denies unknown ids (default deny)', () => {
    expect(getCapability('does.not.exist')).toBeUndefined();
    expect(getCapability('sales.create')).toBeDefined();
  });

  it('AND-composes required permissions', () => {
    const report = getCapability('sales.report.customer');
    expect(report).toBeDefined();
    const onlySales = new Set<Permission>(['read-sales']);
    const both = new Set<Permission>(['read-sales', 'read-customers']);
    expect(permissionsSatisfyCapability(report!, onlySales)).toBe(false);
    expect(permissionsSatisfyCapability(report!, both)).toBe(true);
  });

  it('down-scopes write capabilities for read-only users', () => {
    // customer-support can read sales but cannot write them.
    const permissions = permissionsForRoles(['customer-support']);
    const allowed = capabilitiesForPermissions(permissions).map((capability) => capability.id);
    expect(allowed).toContain('sales.report.customer');
    expect(allowed).not.toContain('sales.create');
  });

  it('matches the documented per-role capability matrix', () => {
    expect(rolesGrantCapability(['sales-user'], 'sales.create')).toBe(true);
    expect(rolesGrantCapability(['support-operations-user'], 'sales.create')).toBe(false);
    expect(rolesGrantCapability(['customer-support'], 'sales.create')).toBe(false);
    expect(rolesGrantCapability(['ops-compliance'], 'sales.create')).toBe(false);

    expect(rolesGrantCapability(['sales-user'], 'actions.markCompleted')).toBe(false);
    expect(rolesGrantCapability(['support-operations-user'], 'actions.markCompleted')).toBe(true);
    expect(rolesGrantCapability(['customer-support'], 'actions.markCompleted')).toBe(true);

    expect(rolesGrantCapability(['ops-compliance'], 'sop.read')).toBe(true);
    expect(rolesGrantCapability(['ops-compliance'], 'sales.report.customer')).toBe(false);
  });

  it('rolesGrantCapability denies unknown capabilities', () => {
    expect(rolesGrantCapability(['admin'], 'unknown.capability')).toBe(false);
  });

  it('requires approval only when explicitly opted in (decoupled from risk)', () => {
    // Approval is an explicit, admin-editable property (default false), not a
    // function of risk. The shipped catalog opts no capability into approval, so
    // permission consent alone authorizes execution regardless of risk level.
    for (const capability of CAPABILITY_CATALOG) {
      expect(capabilityRequiresApproval(capability)).toBe(capability.requiresApproval === true);
    }
  });

  it('reaches the free-form SQL mcp-tools via create-agent-run (per-view gating)', () => {
    // The DB MCP server's own tools are reachable for any agent-run user; the
    // authorization boundary is per-view (see `data-views.ts`), enforced by the
    // MCP server, not a coarse SQL permission.
    for (const id of ['data.schema.describe', 'data.query.select']) {
      const capability = getCapability(id);
      expect(capability).toBeDefined();
      expect(capability!.requiredPermissions).toEqual(['create-agent-run']);
      expect(capability!.risk).toBe('low');
    }
    const runner = new Set<Permission>(['create-agent-run']);
    const allowed = capabilitiesForPermissions(runner).map((capability) => capability.id);
    expect(allowed).toEqual(
      expect.arrayContaining(['data.schema.describe', 'data.query.select']),
    );
    // A domain permission WITHOUT create-agent-run does not reach the SQL tools.
    const noRun = new Set<Permission>(['read-sales']);
    expect(capabilitiesForPermissions(noRun).map((c) => c.id)).not.toContain('data.query.select');
  });

  it('gates the umbrella delegation skills on create-agent-run, not data access', () => {
    // The two umbrellas are broad delegation ENTRY POINTS, not the authorization
    // boundary: any agent-using role (which holds create-agent-run) can reach
    // them, and the agent re-gates every concrete capability per call (Layer B).
    for (const id of ['data.analyse.read', 'data.act.write']) {
      const capability = getCapability(id);
      expect(capability).toBeDefined();
      expect(capability!.requiredPermissions).toEqual(['create-agent-run']);
      expect(capability!.delegated ?? false).toBe(false);
    }
    // A domain read permission alone does NOT surface the umbrellas (no run perm).
    const dataOnly = new Set<Permission>(['read-sales']);
    const dataAllowed = capabilitiesForPermissions(dataOnly).map((c) => c.id);
    expect(dataAllowed).not.toContain('data.analyse.read');
    expect(dataAllowed).not.toContain('data.act.write');
    // A run-capable role reaches both umbrellas regardless of domain data perms.
    const runner = new Set<Permission>(['create-agent-run']);
    const runnerAllowed = capabilitiesForPermissions(runner).map((c) => c.id);
    expect(runnerAllowed).toEqual(
      expect.arrayContaining(['data.analyse.read', 'data.act.write']),
    );
  });

  it('marks every concrete business capability as delegated (agent-internal)', () => {
    // Pure delegator: the orchestrator surfaces ONLY the non-delegated umbrellas.
    // Concrete business caps are delegated; mcp-tools and umbrellas are not.
    const umbrellas = new Set(['data.analyse.read', 'data.act.write']);
    for (const capability of CAPABILITY_CATALOG) {
      if (capability.kind === 'mcp-tool' || umbrellas.has(capability.id)) {
        expect(capability.delegated ?? false).toBe(false);
      } else {
        expect(capability.kind).toBe('agent-skill');
        expect(capability.delegated).toBe(true);
      }
    }
  });

  it('grants the new resolver/read capabilities by their mirrored read permission', () => {
    // Reads follow their REST read permission.
    expect(rolesGrantCapability(['sales-user'], 'customers.search')).toBe(true);
    expect(rolesGrantCapability(['ops-compliance'], 'customers.search')).toBe(false);
    expect(rolesGrantCapability(['sales-user'], 'products.search')).toBe(true);
    expect(rolesGrantCapability(['customer-support'], 'sales.list')).toBe(true);
    expect(rolesGrantCapability(['ops-compliance'], 'sales.get')).toBe(false);
    expect(rolesGrantCapability(['customer-support'], 'issues.get')).toBe(true);
    expect(rolesGrantCapability(['support-operations-user'], 'actions.list')).toBe(true);
    expect(rolesGrantCapability(['ops-compliance'], 'actions.get')).toBe(false);
  });

  it('gates the new write capabilities on their mirrored write permission', () => {
    // write-actions: support-operations-user + customer-support + admin, NOT sales-user.
    for (const id of ['actions.addComment', 'actions.update']) {
      expect(rolesGrantCapability(['support-operations-user'], id)).toBe(true);
      expect(rolesGrantCapability(['customer-support'], id)).toBe(true);
      expect(rolesGrantCapability(['sales-user'], id)).toBe(false);
      expect(rolesGrantCapability(['ops-compliance'], id)).toBe(false);
    }
    // write-issues: support-operations-user + customer-support + admin, NOT sales-user.
    expect(rolesGrantCapability(['support-operations-user'], 'issues.update')).toBe(true);
    expect(rolesGrantCapability(['sales-user'], 'issues.update')).toBe(false);
    // write-sop: admin + ops-compliance only.
    for (const id of ['sop.create', 'sop.update', 'sop.addVersion']) {
      expect(rolesGrantCapability(['ops-compliance'], id)).toBe(true);
      expect(rolesGrantCapability(['admin'], id)).toBe(true);
      expect(rolesGrantCapability(['sales-user'], id)).toBe(false);
      expect(rolesGrantCapability(['customer-support'], id)).toBe(false);
    }
  });

  it('keeps all new capabilities low-risk (no approval gate; RBAC-only)', () => {
    const newIds = new Set([
      'customers.search',
      'customers.get',
      'products.search',
      'products.get',
      'sales.products.forCustomer',
      'sales.list',
      'sales.get',
      'issues.list',
      'issues.get',
      'actions.list',
      'actions.get',
      'actions.addComment',
      'actions.update',
      'issues.update',
      'sop.create',
      'sop.update',
      'sop.addVersion',
    ]);
    for (const capability of CAPABILITY_CATALOG) {
      if (newIds.has(capability.id)) {
        expect(capability.kind).toBe('agent-skill');
        expect(capability.risk).toBe('low');
        expect(capabilityRequiresApproval(capability)).toBe(false);
      }
    }
  });

  it('treats data.act.write as a dispatch skill (no standalone write permission)', () => {
    const dispatch = getCapability('data.act.write');
    expect(dispatch).toBeDefined();
    expect(dispatch!.mode).toBe('write');
    // It never carries a write permission; it is only a delegation entry point
    // gated on the universal create-agent-run, while concrete writes stay gated on
    // their own permission, so the agent cannot mint new write authority.
    expect(dispatch!.requiredPermissions).toEqual(['create-agent-run']);
    // Approval is opt-in (default false): permission consent alone authorizes it.
    expect(capabilityRequiresApproval(dispatch!)).toBe(false);
  });
});
