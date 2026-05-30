---
name: secure-production-engineering
description: Use whenever designing, implementing, refactoring, reviewing, securing, testing, or debugging production application code across React, Node.js/TypeORM, Keycloak RBAC, and Python LangGraph/Langfuse agents.
---

# Secure Production Engineering

This Skill is the repository-wide engineering guardrail for secure, production-ready,
strongly typed, minimal, reusable, and maintainable code. It applies across the whole
stack: React + TypeScript frontend, Node.js + TypeScript + TypeORM backend, Keycloak
bearer-token auth with centralized RBAC, and Python A2A agents built on LangGraph with
Langfuse observability.

Treat the standards in this Skill as defaults, not suggestions. When the repository
already has a stronger or more specific convention, follow that convention and note it.

## When to use

Use this Skill for:

- Any new feature.
- Any backend route, middleware, controller, service, repository, migration, or API contract.
- Any React component, hook, page, state-management, form, or API client change.
- Any Python agent, LangGraph graph, node, tool, state schema, prompt, eval, or Langfuse instrumentation change.
- Any authentication, authorization, RBAC, scope, tenant, audit, security, secrets, or data-access change.
- Any refactor, bug fix, performance optimization, test generation, CI/CD change, or code review.

If you are writing or changing code in this repository, this Skill is in scope.

## Non-negotiable principles

1. Secure by design, default deny, least privilege.
2. Strong typing everywhere.
3. Reuse over one-off implementation.
4. Minimal code over verbose code.
5. Elegant, readable, maintainable design over cleverness.
6. Centralized authentication and authorization.
7. Every backend route passes through shared authn/authz middleware unless explicitly marked public in a typed route registry.
8. No route-level ad hoc permission logic.
9. No frontend-only authorization decisions. The frontend may hide UI; the backend is the source of truth.
10. No business logic in controllers, route handlers, React components, LangGraph node wrappers, or infrastructure adapters.
11. No hardcoded secrets, roles, scopes, URLs, credentials, tenant IDs, or magic strings.
12. No `any`, unsafe casts, `// @ts-ignore`, broad `except Exception`, or untyped Python public APIs without written justification.
13. No unnecessary abstractions, premature frameworks, duplicate utilities, or unrequested boilerplate.
14. No spaghetti code, circular dependencies, god services, god components, hidden side effects, or unbounded global state.
15. No production code without tests for security-sensitive and business-critical behavior.
16. No completed task without a self-review against the Skill checklists.

## Required operating protocol

Follow this workflow before editing code:

1. Inspect the existing repository structure, package managers, frameworks, lint/type/test tools, conventions, and existing auth patterns.
2. Identify the relevant resource files to apply (see below).
3. Produce a short implementation plan before changing code, unless the task is a trivial one-line fix.
4. Prefer modifying existing reusable components over adding new ones.
5. Search for existing patterns before creating new abstractions.
6. Keep the change set as small as possible.
7. Add or update tests before considering the task complete.
8. Run or specify the exact lint, typecheck, test, and security commands that should be run.
9. Self-review the diff against `resources/code-review-checklist.md`.
10. State any assumptions and anything not verified.

## Mandatory output behavior during future coding

Whenever you write code in this repository, you must:

- Mention which standards/resources you applied.
- Explain why a reusable pattern was chosen.
- Highlight security implications.
- List tests added or changed.
- List validation commands run or recommended.
- Explicitly flag unresolved risks.

## Resource map (progressive loading)

Load only the resources relevant to the current task.

| Resource | Load when working on |
| --- | --- |
| `resources/core-engineering-principles.md` | Any code: style, typing, config, dependencies. |
| `resources/architecture-and-reuse.md` | Structure, layering, reuse, avoiding fragmentation. |
| `resources/security-by-design.md` | Any security-relevant change. Always relevant. |
| `resources/auth-keycloak-rbac.md` | Backend auth, routes, RBAC, scopes, tenants. Critical. |
| `resources/backend-node-typeorm.md` | Node.js + TypeORM backend code. |
| `resources/frontend-react.md` | React + TypeScript frontend code. |
| `resources/python-langgraph-agents.md` | Python A2A / LangGraph agent code. |
| `resources/observability-langfuse.md` | Logging, tracing, metrics, Langfuse. |
| `resources/testing-quality-gates.md` | Tests and pre-completion quality gates. |
| `resources/database-typeorm-data-access.md` | Migrations, schema, queries, data access. |
| `resources/api-contracts-and-errors.md` | API contracts, DTOs, error envelopes. |
| `resources/ci-cd-and-release-quality.md` | CI/CD, builds, releases, containers. |
| `resources/code-review-checklist.md` | Before claiming any task complete. Always. |
| `resources/anti-patterns.md` | Quick reference of things to never do. |

## Validation

Validate the Skill library with the read-only checker:

```bash
python .cursor/skills/secure-production-engineering/scripts/validate-skill-files.py
```
