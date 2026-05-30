# Testing and Quality Gates

Tests are part of the task, not an afterthought. Security-sensitive and
business-critical behavior is not done until it is tested.

## Test pyramid

- Unit tests: pure domain logic, helpers, services, validation, permission mapping, LangGraph nodes.
- Integration tests: API routes, middleware, TypeORM repositories, Keycloak token-validation behavior, graph transitions.
- E2E tests: critical user flows.
- Security regression tests: authz bypass, invalid tokens, tenant mismatches, injection, unsafe HTML, prompt injection.

## Mandatory backend authz tests

For every route or route group:

| Scenario | Expected |
| --- | --- |
| Missing token | 401 |
| Malformed/invalid token | 401 |
| Valid token without required scope/permission | 403 |
| Valid token with required scope/permission | success |
| Tenant mismatch (where relevant) | 403 |
| Public route | explicitly tested as public |

## Quality gates before done

Run or recommend the repository's exact commands for:

```text
format
lint
typecheck
unit tests
integration tests for touched areas
security/dependency audit where available
migration validation when database schema changes
```

If you cannot run a command, state that clearly and explain the risk.

## Coverage expectations

- Security-sensitive code requires high-confidence tests.
- New business logic must include meaningful tests.
- Tests verify behavior, not implementation details.
- Do not add shallow tests that only assert mocks were called, unless the interaction
  itself is the behavior under test.
