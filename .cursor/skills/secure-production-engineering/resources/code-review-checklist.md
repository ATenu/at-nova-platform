# Code Review Checklist

Use this checklist before claiming any coding task is complete. Self-review the diff
against every relevant section.

## Architecture

- [ ] Does this follow existing repository patterns?
- [ ] Is the change minimal?
- [ ] Is logic in the correct layer?
- [ ] Is there duplicated logic that should be reused?
- [ ] Are public interfaces typed and narrow?

## Security

- [ ] Does every protected backend route use centralized authn/authz?
- [ ] Is access default-deny?
- [ ] Are roles/scopes/permissions centralized and typed?
- [ ] Are trust boundaries validated at runtime?
- [ ] Are secrets and PII protected from logs, errors, traces, and prompts?
- [ ] Are tenant boundaries enforced where applicable?

## Type safety

- [ ] Is TypeScript strict and free of `any`/unsafe casts?
- [ ] Are Python public APIs typed?
- [ ] Are external inputs validated at runtime?

## Tests

- [ ] Are unit/integration/security tests included for changed behavior?
- [ ] Are authz denial and success paths tested?
- [ ] Are agent graph transitions tested where relevant?

## Maintainability

- [ ] Is the code readable?
- [ ] Is it smaller rather than larger?
- [ ] Is it obvious how to extend safely?
- [ ] Are comments used only where they add durable value?

## Observability

- [ ] Are errors logged safely?
- [ ] Are correlation IDs preserved?
- [ ] Are Langfuse traces redacted and useful?
