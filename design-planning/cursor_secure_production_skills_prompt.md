You are a Principal Staff Software Architect, Senior Security Engineer, Staff Full-Stack Engineer, AI Agent Engineer, and Code Quality Gatekeeper.

Create a reusable Cursor Agent Skills library for this repository that enforces production-grade, secure-by-design, strongly typed, clean, minimal, reusable, maintainable code across the entire application.

The stack is:

- Frontend: React.js with TypeScript.
- Backend: Node.js with TypeScript and TypeORM.
- Authentication and authorization: Keycloak as the bearer token issuer; backend validates tokens and enforces centralized RBAC and scope checks.
- AI/agent layer: multiple A2A Python agents using LangGraph, connected to Langfuse for observability.
- The generated Skills must be reusable during normal coding, refactoring, reviewing, testing, and architecture tasks.

Your output must be a complete set of files that can be committed to the repository and loaded by Cursor.

Do not generate application business features unless explicitly requested. Generate only the Cursor Skill/rule documentation, reusable coding standards, checklists, examples, and optional safe validation scripts that help Cursor produce better code in future tasks.

---

## Mandatory repository output

Create this structure:

```text
.cursor/
  skills/
    secure-production-engineering/
      SKILL.md
      resources/
        core-engineering-principles.md
        architecture-and-reuse.md
        security-by-design.md
        backend-node-typeorm.md
        auth-keycloak-rbac.md
        frontend-react.md
        python-langgraph-agents.md
        observability-langfuse.md
        testing-quality-gates.md
        database-typeorm-data-access.md
        api-contracts-and-errors.md
        ci-cd-and-release-quality.md
        code-review-checklist.md
        anti-patterns.md
      scripts/
        README.md
        validate-skill-files.py
  rules/
    000-core-engineering.mdc
    010-security-by-design.mdc
    020-backend-node-typeorm.mdc
    030-frontend-react.mdc
    040-python-langgraph-agents.mdc
    050-testing-quality-gates.mdc
AGENTS.md
```

If this repository already contains `.cursor/skills`, `.cursor/rules`, `AGENTS.md`, or equivalent standards, preserve existing content and merge carefully instead of overwriting.

Use Cursor-compatible Agent Skill format. Each Skill must be discoverable, concise, and progressively loaded. The top-level `SKILL.md` must include frontmatter with at least:

```yaml
---
name: secure-production-engineering
description: Use whenever designing, implementing, refactoring, reviewing, securing, testing, or debugging production application code across React, Node.js/TypeORM, Keycloak RBAC, and Python LangGraph/Langfuse agents.
---
```

The `.cursor/rules/*.mdc` files must be short bridges that keep the most important rules always available and point Cursor to the relevant Skill resources when deeper guidance is needed. Use frontmatter such as:

```yaml
---
description: Always enforce secure, typed, reusable, minimal, production-grade engineering standards.
alwaysApply: true
---
```

For technology-specific rules, use `globs` so rules attach only when relevant. Example:

```yaml
---
description: Enforce backend TypeScript, TypeORM, Keycloak, RBAC, and API standards.
globs:
  - "backend/**/*.{ts,tsx}"
  - "server/**/*.{ts,tsx}"
  - "api/**/*.{ts,tsx}"
alwaysApply: false
---
```

Adapt the globs to the repository structure after inspecting it.

---

## Non-negotiable principles the Skill must enforce

The Skill must repeatedly enforce these principles in every coding task:

1. Secure by design, default deny, least privilege.
2. Strong typing everywhere.
3. Reuse over one-off implementation.
4. Minimal code over verbose code.
5. Elegant, readable, maintainable design over cleverness.
6. Centralized authentication and authorization.
7. Every backend route must pass through shared authentication and authorization middleware unless explicitly marked public in a typed route registry.
8. No route-level ad hoc permission logic.
9. No frontend-only authorization decisions. The frontend may hide UI, but the backend is the source of truth.
10. No business logic in controllers, route handlers, React components, LangGraph node wrappers, or infrastructure adapters.
11. No hardcoded secrets, roles, scopes, URLs, credentials, tenant IDs, or magic strings.
12. No `any`, unsafe casts, `// @ts-ignore`, broad `except Exception`, or untyped Python public APIs without a written justification.
13. No unnecessary abstractions, premature frameworks, duplicate utilities, or generated boilerplate that does not solve the current task.
14. No spaghetti code, circular dependencies, god services, god components, hidden side effects, or unbounded global state.
15. No production code without tests for security-sensitive and business-critical behavior.
16. No completed task without a self-review against the Skill checklists.

---

## Required content for `SKILL.md`

The top-level `SKILL.md` must be concise but decisive. It must include:

### Purpose

Explain that this Skill is the repository-wide engineering guardrail for secure, production-ready, maintainable code.

### When to use

Use this Skill for:

- Any new feature.
- Any backend route, middleware, controller, service, repository, migration, or API contract.
- Any React component, hook, page, state-management, form, or API client change.
- Any Python agent, LangGraph graph, node, tool, state schema, prompt, eval, or Langfuse instrumentation change.
- Any authentication, authorization, RBAC, scope, tenant, audit, security, secrets, or data-access change.
- Any refactor, bug fix, performance optimization, test generation, CI/CD change, or code review.

### Required operating protocol for Cursor

Cursor must follow this workflow before editing code:

1. Inspect the existing repository structure, package managers, frameworks, lint/type/test tools, conventions, and existing auth patterns.
2. Identify the relevant Skill resource files to apply.
3. Produce a short implementation plan before changing code unless the task is a trivial one-line fix.
4. Prefer modifying existing reusable components over adding new ones.
5. Search for existing patterns before creating new abstractions.
6. Keep the change set as small as possible.
7. Add or update tests before considering the task complete.
8. Run or specify the exact lint, typecheck, test, and security commands that should be run.
9. Self-review the diff against the code review checklist.
10. State any assumptions and anything not verified.

### Mandatory output behavior during future coding

Whenever Cursor writes code, it must:

- Mention which standards/resources it applied.
- Explain why a reusable pattern was chosen.
- Highlight security implications.
- List tests added or changed.
- List validation commands run or recommended.
- Explicitly flag unresolved risks.

---

## Required content for `resources/core-engineering-principles.md`

Create detailed standards covering:

### Code style and simplicity

- Prefer small functions with one responsibility.
- Prefer explicit names over comments explaining unclear code.
- Prefer early returns and guard clauses over deeply nested branching.
- Prefer composition over inheritance unless the codebase already uses inheritance intentionally.
- Prefer pure functions for domain logic.
- Avoid speculative abstractions.
- Avoid duplicate helpers and near-duplicate business logic.
- Avoid clever one-liners when a simple readable expression is clearer.
- Avoid generated boilerplate that is not required by the current task.
- Keep public APIs narrow and intentional.

### Strong typing

- TypeScript must run in strict mode.
- Python public functions must have type hints.
- Domain models, DTOs, API request/response types, route metadata, permissions, scopes, LangGraph state, and tool schemas must be explicit.
- Runtime validation must exist at trust boundaries.
- Static types are not a replacement for input validation.

### Configuration

- Centralize config loading and validation.
- Never read environment variables directly throughout the app.
- Use typed config modules.
- Fail fast on missing or invalid config.
- Never commit secrets.

### Dependency policy

- Prefer existing dependencies.
- Add new libraries only when they clearly reduce complexity or risk.
- Before adding a dependency, document why the standard library or existing dependency is insufficient.
- Avoid libraries with unclear maintenance, weak typing, or poor security posture.

---

## Required content for `resources/architecture-and-reuse.md`

Create architecture rules that force reusable, layered design:

### Layering

Backend code must follow this shape unless the repository already has a better established convention:

```text
transport layer: routes/controllers/http adapters
application layer: use cases/services/orchestrators
domain layer: entities/value objects/domain rules/interfaces
infrastructure layer: TypeORM repositories, Keycloak adapters, external clients
shared layer: typed contracts, errors, logging, config, auth primitives
```

Frontend code must separate:

```text
pages/routes -> feature containers -> hooks -> presentational components -> shared UI primitives -> typed API client
```

Python agent code must separate:

```text
agent graph definitions -> typed state schemas -> node functions -> tool adapters -> external clients -> observability/eval utilities
```

### Reuse rules

- If logic is used twice, extract it.
- If logic is security-sensitive, centralize it before first use.
- If a pattern exists, extend the pattern instead of creating a parallel one.
- All shared modules must have stable public interfaces.
- Avoid dumping unrelated helpers into generic `utils` files.
- Use feature/domain-oriented modules rather than technical-layer dumping grounds when appropriate.

### Anti-fragmentation rules

- Do not create multiple competing API clients.
- Do not create multiple auth clients.
- Do not create multiple logging helpers.
- Do not create multiple error formats.
- Do not create multiple validation approaches unless a transition plan exists.
- Do not create local role/scope constants in features.

---

## Required content for `resources/security-by-design.md`

Create a complete secure coding policy covering:

### Security defaults

- Default deny.
- Least privilege.
- Defense in depth.
- Explicit allowlists over denylists.
- Validate all inputs at boundaries.
- Encode outputs appropriately.
- Never trust frontend state, request bodies, headers, cookies, or agent-provided text.
- Avoid leaking stack traces, tokens, secrets, PII, internal URLs, infrastructure details, or permission models.

### Authentication

- Keycloak is the identity provider and bearer token issuer.
- Backend must validate bearer tokens using a centralized authentication component.
- Validate issuer, audience, expiration, not-before, algorithm, signature, and required claims.
- Use JWKS with safe caching and rotation handling.
- Reject unsigned tokens and unexpected algorithms.
- Reject tokens missing required claims.
- Normalize authenticated principal data into a typed `AuthContext`.
- Never decode JWTs without validation for authorization decisions.

### Authorization

- Enforce centralized RBAC and scope checks.
- Use typed permission definitions.
- Authorization must be performed on the backend for every protected route.
- Route metadata must declare required permission/scope.
- Missing route metadata must fail closed.
- Public routes must be explicitly marked public and reviewed.
- Role checks must use domain permissions, not scattered raw Keycloak role strings.
- Support tenant/org/project-level constraints where applicable.
- Audit sensitive authorization decisions.

### Secrets

- Secrets must come from secret managers or validated environment configuration.
- Never log secrets, tokens, cookies, authorization headers, refresh tokens, API keys, private prompts, or credentials.
- Redact sensitive values in logs and Langfuse metadata.

### Web/API hardening

- Enforce restrictive CORS.
- Use secure headers.
- Apply request body size limits.
- Apply rate limiting and abuse controls to sensitive endpoints.
- Use idempotency keys for high-risk mutating operations when appropriate.
- Use CSRF protection where cookie-based auth is introduced.
- Return consistent error shapes.
- Do not expose internal exception details.

### Agent security

- Treat LLM inputs and tool outputs as untrusted.
- Validate tool inputs with schemas.
- Allowlist tools by agent and use case.
- Add authorization checks before tools perform sensitive actions.
- Prevent prompt injection from overriding system, security, or authorization rules.
- Never put secrets in prompts, traces, tool responses, or Langfuse-visible fields.
- Redact PII and secrets from traces.
- Add human approval gates for destructive or externally visible actions.

### Data protection

- Classify sensitive data.
- Log the minimum required data.
- Avoid unnecessary persistence of prompts, completions, and user data.
- Define retention expectations.
- Use encryption in transit and at rest.

---

## Required content for `resources/auth-keycloak-rbac.md`

Create a detailed reusable backend authorization design. This is critical.

### Required design goal

Every backend route must use a single centralized authentication and authorization pipeline. Cursor must never generate a route that bypasses it unless the route is explicitly public and documented.

### Required abstractions

Define the Skill guidance around these typed concepts. Names can be adapted to the existing codebase, but the architecture must remain centralized:

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

### Required backend pipeline

The Skill must instruct Cursor to create or reuse these components when implementing backend routes:

```text
request -> request id/correlation id -> authentication middleware -> auth context builder -> route policy resolver -> centralized authorization middleware -> validation middleware -> controller -> service/use case -> repository/external client
```

### Mandatory route rule

For every non-public route:

```text
No route is valid unless it is registered in a typed route policy registry and composed with the shared authentication and authorization middleware.
```

### Required examples

Include minimal examples showing the pattern without over-generating code:

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

Explain that the exact router framework may differ, but the centralized pattern must not.

### Required deny behavior

- Missing token: 401.
- Invalid token: 401.
- Valid token but missing permission/scope: 403.
- Missing policy metadata on protected route: fail closed and surface a development-time error.
- Tenant mismatch: 403.
- Public route with auth-sensitive behavior: reject unless reviewed.

### Required tests

Every route or route group must have tests for:

- No token.
- Invalid token.
- Valid token missing scope/permission.
- Valid token with correct scope/permission.
- Tenant boundary enforcement where applicable.
- Public route behavior where applicable.

---

## Required content for `resources/backend-node-typeorm.md`

Create standards for Node.js backend code:

### TypeScript

- Use strict TypeScript.
- Avoid `any`; use `unknown` plus narrowing when needed.
- Export explicit public types.
- Use discriminated unions for domain states and error categories.
- Validate external input at runtime.

### Route/controller layer

- Controllers must be thin.
- Controllers handle request mapping, response mapping, and error forwarding only.
- No business logic, database queries, direct Keycloak calls, or external service logic in controllers.
- Every route must use centralized auth unless explicitly public.
- Every request body, query, params, and header contract must be validated.

### Service/use-case layer

- Business rules live in services/use cases.
- Services receive typed inputs and an `AuthContext` when authorization-relevant.
- Services do not parse HTTP requests.
- Services do not return raw ORM entities to controllers.

### TypeORM/data layer

- Use repositories/data-access services behind interfaces where useful.
- Use migrations for schema changes.
- Never use `synchronize: true` in production.
- Parameterize all queries.
- Avoid raw SQL unless necessary; if used, isolate it, type it, parameterize it, and test it.
- Make transaction boundaries explicit.
- Avoid N+1 queries.
- Use pagination for list endpoints.
- Add indexes intentionally for common filters and joins.
- Avoid leaking persistence entities as API DTOs.
- Handle optimistic locking or concurrency where needed.

### Errors

- Use typed domain/application errors.
- Map errors to consistent API responses centrally.
- Never leak stack traces or ORM errors to clients.
- Prefer RFC 7807-style problem responses or the repository’s existing standard.

### Logging

- Use structured logs.
- Include correlation/request IDs.
- Do not log secrets or full tokens.
- Log authorization denials without leaking sensitive policy internals.

---

## Required content for `resources/frontend-react.md`

Create standards for React frontend code:

### TypeScript and components

- Use TypeScript strictly.
- Components must have explicit props types.
- Prefer composition and small components.
- Separate smart/container components from presentational components when complexity grows.
- Avoid large components with mixed data fetching, formatting, authorization, rendering, and mutation logic.
- Avoid duplicating UI primitives.
- Avoid unnecessary global state.

### API access

- Use a single typed API client.
- Prefer generated clients from OpenAPI or shared contracts when available.
- Do not call `fetch`/`axios` directly throughout components.
- Centralize token attachment, request IDs, error normalization, retries, and timeout behavior.
- Never trust frontend authorization checks as security controls.

### Keycloak frontend usage

- Use a centralized auth provider/hook.
- Store tokens safely according to the repository’s chosen approach.
- Do not scatter token parsing or role checks across components.
- UI may conditionally render based on permissions for usability, but backend authorization is mandatory.
- Handle login, logout, refresh, and expired sessions consistently.

### Forms and validation

- Use schema-based validation aligned with backend contracts where possible.
- Validate before submit for usability.
- Treat backend validation as authoritative.
- Display safe error messages.

### Security

- Avoid unsafe HTML rendering.
- If `dangerouslySetInnerHTML` is unavoidable, sanitize and document why.
- Avoid exposing sensitive data in local storage, logs, analytics, or errors.
- Respect CSP constraints.

### Accessibility and performance

- Use semantic HTML.
- Ensure keyboard navigation and labels.
- Avoid unnecessary re-renders.
- Use memoization only when it helps measured or obvious performance issues.
- Use code splitting for large routes/features when appropriate.

---

## Required content for `resources/python-langgraph-agents.md`

Create standards for Python A2A agents using LangGraph:

### Python code quality

- Use Python 3.11+ conventions unless repository specifies otherwise.
- Use full type hints on public functions, graph state, node inputs/outputs, tools, and clients.
- Prefer Pydantic models or TypedDict for graph state and tool schemas.
- Use Ruff/Black/isort/mypy or the repository’s existing tools.
- Keep node functions small and testable.
- Avoid hidden global mutable state.
- Avoid broad `except Exception` unless followed by typed error handling and re-raise or safe recovery.

### LangGraph design

- Define graph state explicitly.
- Keep nodes deterministic where possible.
- Separate prompt construction, model invocation, tool execution, validation, and state transitions.
- Validate node outputs before updating graph state.
- Model retry and fallback behavior explicitly.
- Make termination conditions explicit.
- Add timeouts and max-iteration guards.

### A2A agent communication

- Treat other agents as untrusted boundaries.
- Validate every inbound and outbound agent message.
- Use typed message envelopes.
- Include correlation IDs, trace IDs, sender, receiver, purpose, timestamp, and schema version where appropriate.
- Enforce authentication/authorization before sensitive agent actions.
- Add idempotency for retried agent commands.
- Avoid free-form agent-to-agent commands for privileged operations.

### Tool safety

- Tool inputs must be schema validated.
- Tools must be allowlisted per agent.
- Tools that mutate data, call external services, send messages, or access secrets require explicit authorization and auditability.
- Destructive actions require human approval unless the product explicitly allows autonomy.

### Prompt and injection safety

- Do not let user, document, web, email, tool, or agent-provided text override system/developer/security instructions.
- Separate instructions from data.
- Quote or delimit untrusted content.
- Never expose hidden prompts, credentials, tokens, or internal policies.
- Avoid placing secrets or full PII in prompts.

### Testing agents

- Unit test node logic.
- Integration test graph transitions.
- Mock LLM and tool calls for deterministic tests.
- Add regression tests for prompt-injection and unsafe tool-call scenarios.
- Add eval datasets for core agent behaviors where possible.

---

## Required content for `resources/observability-langfuse.md`

Create observability standards:

### Cross-application observability

- Every request/operation should have a correlation ID.
- Logs, traces, metrics, and errors should be linkable.
- Use structured logging.
- Avoid logging secrets, tokens, credentials, PII, or raw prompts unless explicitly allowed and redacted.

### Backend observability

- Log auth failures, permission denials, validation failures, and unexpected errors safely.
- Instrument database latency and external calls.
- Include route ID and policy ID for authorization decisions where safe.

### Langfuse observability

- Instrument LangGraph agent runs with traces/spans.
- Capture model, prompt version, tool calls, latency, token usage, and outcome metadata.
- Redact sensitive inputs and outputs.
- Do not send secrets or unnecessary PII to Langfuse.
- Use Langfuse metadata for correlation IDs, tenant IDs only when policy allows, environment, version, and evaluation labels.
- Track eval results and regression outcomes.

---

## Required content for `resources/testing-quality-gates.md`

Create a comprehensive test policy:

### Test pyramid

- Unit tests for pure domain logic, helpers, services, validation, permission mapping, and LangGraph nodes.
- Integration tests for API routes, middleware, TypeORM repositories, Keycloak token validation behavior, and graph transitions.
- E2E tests for critical user flows.
- Security regression tests for authz bypass, invalid tokens, tenant mismatches, injection, unsafe HTML, and prompt injection.

### Mandatory backend authz tests

For every route or route group:

- Missing token returns 401.
- Malformed/invalid token returns 401.
- Valid token without required scope/permission returns 403.
- Valid token with required scope/permission succeeds.
- Tenant mismatch returns 403 where relevant.
- Public routes are explicitly tested as public.

### Quality gates before done

Cursor must run or recommend the repository’s exact commands for:

```text
format
lint
typecheck
unit tests
integration tests for touched areas
security/dependency audit where available
migration validation when database schema changes
```

If Cursor cannot run a command, it must state that clearly and explain the risk.

### Coverage expectations

- Security-sensitive code requires high-confidence tests.
- New business logic must include meaningful tests.
- Tests should verify behavior, not implementation details.
- Do not add shallow tests that only assert mocks were called unless interaction is the behavior.

---

## Required content for `resources/database-typeorm-data-access.md`

Create standards for database and TypeORM usage:

- Use migrations for all schema changes.
- Keep migrations reversible where practical.
- Review generated migrations before committing.
- Use explicit column types and constraints.
- Use indexes intentionally.
- Avoid nullable columns unless domain meaning is clear.
- Avoid storing derived data unless justified.
- Keep transaction boundaries explicit.
- Add isolation/concurrency handling for high-risk operations.
- Avoid returning ORM entities directly from API responses.
- Map persistence models to DTOs.
- Protect against SQL injection with parameterized queries.
- Prevent N+1 query patterns.
- Use pagination and limits for list queries.
- Add data retention and deletion considerations for sensitive data.

---

## Required content for `resources/api-contracts-and-errors.md`

Create standards for API contracts:

- Use OpenAPI or the repository’s existing API contract approach.
- API contracts must include auth requirements, request schemas, response schemas, and error responses.
- Use stable DTOs instead of raw entities.
- Version APIs intentionally.
- Use consistent pagination, filtering, and sorting patterns.
- Use consistent error envelopes.
- Avoid leaking internal implementation details.
- Document permissions/scopes for each route.
- Add contract tests when route behavior changes.

Include a preferred error shape such as:

```ts
type ApiErrorResponse = {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code: string;
  correlationId: string;
};
```

Adapt to existing repository standards if present.

---

## Required content for `resources/ci-cd-and-release-quality.md`

Create CI/CD standards:

- CI must run lint, typecheck, tests, and build.
- CI should run dependency audit, secret scan, SAST, container scan, and license checks where available.
- Database migrations must be checked before deployment.
- Containers must run as non-root where possible.
- Images should be minimal and pinned appropriately.
- Services must expose health/readiness checks.
- Production config must fail fast when invalid.
- Releases must include rollback considerations.
- Do not weaken CI to make generated code pass.

---

## Required content for `resources/code-review-checklist.md`

Create a checklist Cursor must use before claiming a coding task is complete:

### Architecture

- Does this follow existing repository patterns?
- Is the change minimal?
- Is logic in the correct layer?
- Is there duplicated logic that should be reused?
- Are public interfaces typed and narrow?

### Security

- Does every protected backend route use centralized authn/authz?
- Is access default-deny?
- Are roles/scopes/permissions centralized and typed?
- Are trust boundaries validated?
- Are secrets and PII protected from logs, errors, traces, and prompts?
- Are tenant boundaries enforced where applicable?

### Type safety

- Is TypeScript strict and free of `any`/unsafe casts?
- Are Python public APIs typed?
- Are external inputs validated at runtime?

### Tests

- Are unit/integration/security tests included for changed behavior?
- Are authz denial and success paths tested?
- Are agent graph transitions tested where relevant?

### Maintainability

- Is the code readable?
- Is it smaller rather than larger?
- Is it obvious how to extend safely?
- Are comments used only where they add durable value?

### Observability

- Are errors logged safely?
- Are correlation IDs preserved?
- Are Langfuse traces redacted and useful?

---

## Required content for `resources/anti-patterns.md`

Create a list of anti-patterns Cursor must avoid:

- One-off route permission checks.
- Decoding JWTs without validation.
- Trusting frontend role checks.
- Duplicating auth logic in controllers.
- Putting business logic in route handlers.
- Returning TypeORM entities directly from APIs.
- Adding raw SQL without parameterization and tests.
- Adding global mutable state for request-specific data.
- Adding untyped `any` because typing is inconvenient.
- Adding multiple API clients.
- Adding multiple logger implementations.
- Adding multiple validation libraries without a migration plan.
- Adding broad catch blocks that swallow errors.
- Logging tokens, prompts, raw agent messages, or secrets.
- Storing long-lived tokens in unsafe browser storage without explicit architectural approval.
- Using `dangerouslySetInnerHTML` without sanitization.
- Letting prompt-injected content trigger tools or bypass policy.
- Generating large boilerplate scaffolds for small tasks.
- Adding abstractions with only one caller unless they are security boundaries or clear domain concepts.
- Weakening lint/type/test/CI settings to make code pass.

---

## Required content for `.cursor/rules/*.mdc`

Create concise project rules that make the Skill effective during daily coding.

### `000-core-engineering.mdc`

Must be always applied. It should say:

- Follow `.cursor/skills/secure-production-engineering/SKILL.md`.
- Prefer simple, typed, reusable, minimal code.
- Inspect existing patterns before creating new ones.
- Do not generate code that bypasses security, tests, or architecture rules.
- Before completing, self-review against `resources/code-review-checklist.md`.

### `010-security-by-design.mdc`

Must be always applied. It should say:

- Default deny.
- No backend route without centralized authn/authz unless explicitly public.
- No ad hoc permission checks.
- No secrets/PII leakage.
- Validate all trust boundaries.
- Apply `resources/security-by-design.md` and `resources/auth-keycloak-rbac.md`.

### Technology-specific `.mdc` files

Use globs for backend, frontend, and Python agent code. Each file must point to the matching resource files and list only the highest-priority rules to reduce context bloat.

---

## Required content for `AGENTS.md`

Create a repository-level `AGENTS.md` that briefly tells any coding agent:

- This repository uses Cursor Skills under `.cursor/skills/secure-production-engineering`.
- Follow the secure-by-design and centralized RBAC standards.
- Use the code review checklist before completing tasks.
- Do not bypass the auth middleware/policy registry.
- Keep code strongly typed, minimal, reusable, and tested.

If an existing `AGENTS.md` exists, merge without destroying existing instructions.

---

## Optional validation script

Create `scripts/validate-skill-files.py` as a safe, read-only validation helper. It should check that:

- Required files exist.
- `SKILL.md` contains name and description frontmatter.
- `.cursor/rules` contains required bridge rules.
- Security-sensitive files mention centralized authz, Keycloak, RBAC, scopes, and default deny.

The script must not modify files. It must print clear pass/fail messages.

---

## Cursor implementation constraints

While creating these Skill files:

- Do not overwrite existing standards without merging.
- Keep each file readable and focused.
- Avoid making a single massive rule file that bloats context.
- Prefer one top-level Skill with progressively loaded resource files.
- Include examples only when they clarify reusable patterns.
- Do not generate full application code.
- Do not add dependencies.
- Do not modify application runtime behavior.
- Do not edit unrelated files.

---

## Final response required from Cursor after generation

After creating the files, respond with:

1. Files created or updated.
2. Any existing files merged.
3. How to use the Skill in Cursor.
4. Which rules are always applied.
5. Which resources are loaded on demand.
6. Any assumptions made about repository structure.
7. Validation command to run, for example:

```bash
python .cursor/skills/secure-production-engineering/scripts/validate-skill-files.py
```

---

## Future behavior this Skill must enforce

After the Skill is created, every future Cursor coding response in this repository should implicitly follow this standard:

```text
Think like a senior production engineer.
Make the smallest safe change.
Use existing patterns first.
Keep everything strongly typed.
Centralize auth, permissions, config, errors, logging, and API access.
Validate every trust boundary.
Never bypass Keycloak token validation, centralized RBAC, route policy metadata, or scope checks.
Never rely on frontend authorization for security.
Add tests for security-sensitive and business-critical logic.
Instrument safely with structured logs and Langfuse where relevant.
Avoid unnecessary code and abstractions.
Self-review before claiming completion.
```

---
