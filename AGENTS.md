# AGENTS.md

Guidance for any coding agent working in this repository.

## Engineering standards

This repository uses a Cursor Skill at
`.cursor/skills/secure-production-engineering/SKILL.md`. Read and follow it for any
design, implementation, refactor, review, security, testing, or debugging task across
the stack:

- Frontend: React + TypeScript.
- Backend: Node.js + TypeScript + TypeORM.
- Auth: Keycloak bearer tokens, validated by the backend with centralized RBAC and scope checks.
- AI: Python A2A agents on LangGraph, observed with Langfuse.

## Non-negotiables

- Secure by design, default deny, least privilege.
- Centralized authentication and authorization. Do not bypass the shared auth
  middleware or the typed route policy registry. No ad hoc, route-level permission checks.
- Never rely on frontend authorization as a security control.
- Strongly typed everywhere; validate all trust boundaries at runtime.
- Minimal, reusable code. Reuse existing patterns before creating new ones.
- Never log or expose secrets, tokens, or PII (including in prompts and Langfuse traces).
- Add tests for security-sensitive and business-critical behavior.

## Before completing any task

Self-review against
`.cursor/skills/secure-production-engineering/resources/code-review-checklist.md`,
then run or recommend the repository's format, lint, typecheck, and test commands. Do
not weaken lint/type/test/CI settings to make code pass.

## Validate the Skill library

```bash
python .cursor/skills/secure-production-engineering/scripts/validate-skill-files.py
```
