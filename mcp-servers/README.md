# mcp-servers

Standalone [Model Context Protocol](https://modelcontextprotocol.io) servers
that expose tools/resources to A2A agents, beyond the database surfacer (which
lives in `backend-services/db-mcp-server`).

Each server is a direct child of this folder, e.g. `mcp-servers/knowledge/`,
`mcp-servers/email/`, and owns its own configuration (it is not part of the
`backend-services/` workspace).

## Conventions

- Validate every tool input at the trust boundary with `zod`.
- Allowlist tools and expose least privilege; default deny.
- Never place secrets or PII in tool responses, prompts, or traces.
- Ship a `tsconfig.json`, a `jest.config.js`, and tests for tool input
  validation and authorization.
- If a server needs the shared DB schema, prefer calling the
  `backend-services/db-mcp-server` rather than opening its own connection.

## Scaffolding a new server

1. Create `mcp-servers/<name>/` with its own `package.json`, `tsconfig.json`,
   `jest.config.js`, and `src/main.ts`.
2. Add the MCP SDK (`@modelcontextprotocol/sdk`) and register tools backed by
   typed services.
3. Add a service to the root `docker-compose.yml` if it should run in the stack.
