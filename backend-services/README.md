# backend-services

The **self-contained npm workspace** for the platform's Node.js + TypeScript
backend. It owns its own `package.json` (workspace root), `package-lock.json`,
`tsconfig.base.json`, ESLint/Prettier config, and `Dockerfile`. Run all backend
npm commands from this folder.

```bash
cd backend-services
npm install
npm run build      # shared -> database -> api -> db-mcp-server
npm run lint && npm run typecheck && npm test
```

The frontend and Python agents live elsewhere and carry their own
configuration; they are not part of this workspace.

## Layout

| Path               | Package               | Responsibility                                                              |
| ------------------ | --------------------- | --------------------------------------------------------------------------- |
| `packages/shared/` | `@nova/shared`        | Typed RBAC, errors, structured logging, config loading.                     |
| `packages/database/`| `@nova/database`     | TypeORM entities, migrations, seeds, DataSource (single source of truth).   |
| `api/`             | `@nova/api`           | Secure Express HTTP API: auth pipeline, typed route-policy RBAC, feature modules. |
| `db-mcp-server/`   | `@nova/db-mcp-server` | Read-only schema data-surfacer / DB MCP server for A2A agents.              |

Each service consumes `@nova/shared` and `@nova/database` instead of redefining
RBAC or the schema.

## Docker

The root `docker-compose.yml` builds this folder (`context: ./backend-services`,
`Dockerfile`) for the `db-init` and `api` services. Bring up the whole stack
with a single `docker compose up` from the repository root.

## Conventions

- Strongly typed; no `any`, no unsafe casts (see `.cursor/skills/secure-production-engineering`).
- Centralized authentication and authorization — never add ad hoc, route-level
  permission checks.
- Reuse `@nova/shared` and `@nova/database`; never duplicate the schema or RBAC.
- Each service owns a `tsconfig.json` extending the root `tsconfig.base.json`,
  a `jest.config.js`, and a `package.json` named `@nova/<service>`.
- Tests live beside the code (`*.test.ts`) for security-sensitive and
  business-critical behavior.
