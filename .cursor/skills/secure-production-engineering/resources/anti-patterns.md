# Anti-Patterns

Never do these. If a task seems to require one, stop and reconsider the design.

## Authorization and auth

- One-off route permission checks.
- Decoding JWTs without validation.
- Trusting frontend role checks as a security control.
- Duplicating auth logic in controllers.

## Architecture

- Putting business logic in route handlers, controllers, or React components.
- Adding global mutable state for request-specific data.
- Adding multiple API clients.
- Adding multiple logger implementations.
- Adding multiple validation libraries without a migration plan.
- Generating large boilerplate scaffolds for small tasks.
- Adding abstractions with only one caller unless they are security boundaries or clear domain concepts.

## Data access

- Returning TypeORM entities directly from APIs.
- Adding raw SQL without parameterization and tests.

## Type safety and errors

- Adding untyped `any` because typing is inconvenient.
- Adding broad catch blocks that swallow errors.

## Secrets and observability

- Logging tokens, prompts, raw agent messages, or secrets.
- Storing long-lived tokens in unsafe browser storage without explicit architectural approval.

## Frontend

- Using `dangerouslySetInnerHTML` without sanitization.

## Agents

- Letting prompt-injected content trigger tools or bypass policy.

## Process

- Weakening lint/type/test/CI settings to make code pass.
