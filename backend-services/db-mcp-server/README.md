# @nova/db-mcp-server — data-surfacer

A read-only **data-surfacer** for Nova's A2A agents. It reuses the shared
`@nova/database` TypeORM layer (entities, `DataSource`) so there is a single
source of truth for the schema — the MCP server never redefines tables.

## What exists today

- `src/schema/describe-schema.ts` — surfaces tables, columns (types, enums,
  nullability, keys), relations, and indexes from TypeORM metadata. This is the
  schema-discovery core agents use to navigate the data correctly.
- `src/main.ts` — initializes the `DataSource` and prints the surfaced schema as
  JSON. Run it with `npm run surface-schema -w @nova/db-mcp-server`.

## Turning this into an MCP server

1. Add an MCP SDK dependency (e.g. `@modelcontextprotocol/sdk`).
2. Register read-only tools backed by the shared layer:
   - `describe_schema` → returns `describeSchema(dataSource)`.
   - `list_<entity>` / `get_<entity>` → typed, **parameterized**, paginated
     reads via repositories (mirror the API's repository pattern).
3. Enforce the platform guardrails:
   - Validate every tool input with a schema (zod).
   - Allowlist tools; expose **only** read access for surfacing.
   - Never put secrets/PII in tool responses, prompts, or traces.
   - Reuse `@nova/shared` RBAC to scope what an agent may surface.

Because connection, entities, and config already live in `@nova/database`,
standing up the server is just adding the transport and the tool wrappers.
