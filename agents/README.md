# agents

Python A2A (agent-to-agent) services built on **LangGraph** and observed with
**Langfuse**. These are deliberately **outside** the npm workspaces — they use
their own Python tooling (e.g. `uv`/`poetry`) and dependency isolation per agent.

Each agent is a direct child of this folder, e.g. `agents/triage/`,
`agents/resolver/`.

## Conventions

- Strongly typed Python; typed public APIs and typed LangGraph state schemas.
- Agents reach platform data through the MCP servers
  (`backend-services/db-mcp-server`, `mcp-servers/*`) or the API — they do not
  open their own database connections or redefine the schema.
- Validate all trust boundaries (tool inputs, model outputs) at runtime.
- Never log or trace secrets or PII, including inside prompts and Langfuse spans.
- Provide evals for business-critical agent behavior.

## Scaffolding a new agent

1. Create `agents/<name>/` with its own `pyproject.toml`, `src/`, and tests.
2. Wire Langfuse tracing and configure tools against the platform's MCP servers.
