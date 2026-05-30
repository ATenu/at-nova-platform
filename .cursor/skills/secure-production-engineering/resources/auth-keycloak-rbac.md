# Auth: Keycloak + Centralized RBAC

This is the most important security resource. Every backend route must use a single
centralized authentication and authorization pipeline. Never generate a route that
bypasses it unless the route is explicitly public and documented.

## Design goal

One pipeline validates tokens, builds a typed principal, resolves the route policy,
and enforces RBAC/scope. Features never re-implement any part of this.

## Required typed abstractions

Names may be adapted to the existing codebase, but the architecture must stay
centralized and typed.

```ts
type AuthContext = {
  subject: string;
  issuer: string;
  audience: string[];
  email?: string;
  username?: string;
  tenantId?: string;
  roles: readonly Role[];
  scopes: readonly Scope[];
  claims: Readonly<Record<string, unknown>>;
};

type Permission = `${Resource}:${Action}`;

type RouteAccessPolicy = {
  routeId: string;
  public?: boolean;
  permission?: Permission;
  requiredScopes?: readonly Scope[];
  requiredRoles?: readonly Role[];
  tenantBoundary?: "required" | "optional" | "none";
  audit?: boolean;
};
```

`Role`, `Scope`, `Resource`, and `Action` are centralized typed enums/unions. Never
inline raw Keycloak role strings in feature code.

## Required backend pipeline

```text
request
  -> request id / correlation id
  -> authentication middleware (validate bearer token)
  -> auth context builder (normalize claims into typed AuthContext)
  -> route policy resolver (look up RouteAccessPolicy by routeId)
  -> centralized authorization middleware (RBAC + scope + tenant)
  -> validation middleware (schema-validate body/query/params/headers)
  -> controller
  -> service / use case
  -> repository / external client
```

## Mandatory route rule

```text
No route is valid unless it is registered in a typed route policy registry and
composed with the shared authentication and authorization middleware.
```

A protected route with no registered policy must fail closed and surface a
development-time error.

## Example (pattern, not prescription of framework)

```ts
const routePolicy = defineRoutePolicy({
  routeId: "project.read",
  permission: "project:read",
  requiredScopes: ["projects:read"],
  tenantBoundary: "required",
  audit: true,
});

router.get(
  "/projects/:projectId",
  authenticateBearerToken,
  authorize(routePolicy),
  validateRequest(getProjectSchema),
  getProjectController,
);
```

The exact router framework may differ (Express, Fastify, NestJS, etc.), but the
centralized composition (authenticate -> authorize(policy) -> validate -> controller)
must not.

## Required deny behavior

| Condition | Response |
| --- | --- |
| Missing token | 401 |
| Invalid/expired/malformed token | 401 |
| Valid token, missing permission/scope | 403 |
| Tenant mismatch | 403 |
| Protected route missing policy metadata | Fail closed + development-time error |
| Public route with auth-sensitive behavior | Reject unless explicitly reviewed |

## Required tests

Every route or route group must test:

- No token.
- Invalid token.
- Valid token missing required scope/permission.
- Valid token with correct scope/permission.
- Tenant boundary enforcement where applicable.
- Public route behavior where applicable.

See `testing-quality-gates.md` for the mandatory authz test matrix.
