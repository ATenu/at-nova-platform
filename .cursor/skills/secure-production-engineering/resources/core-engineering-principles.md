# Core Engineering Principles

Defaults for all code in this repository. Prefer the repository's established
convention when it is stronger or more specific, and note the deviation.

## Code style and simplicity

- Prefer small functions with one responsibility.
- Prefer explicit names over comments explaining unclear code.
- Prefer early returns and guard clauses over deeply nested branching.
- Prefer composition over inheritance unless the codebase already uses inheritance intentionally.
- Prefer pure functions for domain logic; isolate side effects at the edges.
- Avoid speculative abstractions. Solve the current task, not an imagined future one.
- Avoid duplicate helpers and near-duplicate business logic. Extract on the second use.
- Avoid clever one-liners when a simple readable expression is clearer.
- Avoid generated boilerplate that is not required by the current task.
- Keep public APIs narrow and intentional. Export only what callers need.

## Strong typing

- TypeScript must run in `strict` mode. No `any`, no unsafe casts, no `// @ts-ignore` without written justification.
- Python public functions must have type hints (parameters and return types).
- The following must be explicit types, never inferred-as-`any` or stringly-typed:
  domain models, DTOs, API request/response types, route metadata, permissions,
  scopes, LangGraph state, and tool schemas.
- Runtime validation must exist at trust boundaries (HTTP, queue, agent, file, env).
- Static types are not a replacement for input validation. Validate untrusted input
  at runtime even when a type annotation already describes the expected shape.

## Configuration

- Centralize config loading and validation in a typed config module.
- Never read environment variables directly throughout the app. Read them once, validate, expose typed values.
- Fail fast on missing or invalid config at startup, not deep inside request handling.
- Never commit secrets. Use secret managers or validated environment configuration.

## Dependency policy

- Prefer existing dependencies and the standard library.
- Add a new library only when it clearly reduces complexity or risk.
- Before adding a dependency, document why the standard library or an existing
  dependency is insufficient.
- Avoid libraries with unclear maintenance, weak typing, or poor security posture.
- Do not add dependencies as a side effect of an unrelated change.
