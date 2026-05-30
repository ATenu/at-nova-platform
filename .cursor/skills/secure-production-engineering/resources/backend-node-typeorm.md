# Backend: Node.js + TypeScript + TypeORM

Standards for backend code. Pairs with `auth-keycloak-rbac.md`,
`database-typeorm-data-access.md`, and `api-contracts-and-errors.md`.

## TypeScript

- Use strict TypeScript.
- Avoid `any`; use `unknown` plus narrowing when the type is genuinely dynamic.
- Export explicit public types for module boundaries.
- Use discriminated unions for domain states and error categories.
- Validate external input at runtime (body, query, params, headers, env, queue messages).

## Route / controller layer

- Controllers must be thin.
- Controllers handle request mapping, response mapping, and error forwarding only.
- No business logic, database queries, direct Keycloak calls, or external service logic in controllers.
- Every route uses centralized auth unless explicitly public (see `auth-keycloak-rbac.md`).
- Every request body, query, params, and header contract must be validated.

## Service / use-case layer

- Business rules live in services / use cases.
- Services receive typed inputs and an `AuthContext` when authorization-relevant.
- Services do not parse HTTP requests.
- Services do not return raw ORM entities to controllers; they return DTOs or domain objects.

## TypeORM / data layer

- Use repositories / data-access services behind interfaces where useful for testing and reuse.
- Use migrations for schema changes.
- Never use `synchronize: true` in production.
- Parameterize all queries.
- Avoid raw SQL unless necessary; if used, isolate it, type it, parameterize it, and test it.
- Make transaction boundaries explicit.
- Avoid N+1 queries (use relations, joins, or batched loads).
- Use pagination for list endpoints.
- Add indexes intentionally for common filters and joins.
- Do not leak persistence entities as API DTOs.
- Handle optimistic locking or concurrency where needed.

See `database-typeorm-data-access.md` for full data-access detail.

## Errors

- Use typed domain/application errors.
- Map errors to consistent API responses centrally (one error-handling middleware).
- Never leak stack traces or ORM errors to clients.
- Prefer RFC 7807-style problem responses or the repository's existing standard.

## Logging

- Use structured logs (one shared logger).
- Include correlation/request IDs on every log line in a request scope.
- Do not log secrets or full tokens.
- Log authorization denials without leaking sensitive policy internals.

See `observability-langfuse.md`.
