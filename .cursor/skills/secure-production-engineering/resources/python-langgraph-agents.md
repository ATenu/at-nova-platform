# Python A2A Agents: LangGraph

Standards for Python agents using LangGraph. Pairs with `observability-langfuse.md`
and the agent-security section of `security-by-design.md`.

## Python code quality

- Use Python 3.11+ conventions unless the repository specifies otherwise.
- Use full type hints on public functions, graph state, node inputs/outputs, tools, and clients.
- Prefer Pydantic models or `TypedDict` for graph state and tool schemas.
- Use Ruff/Black/isort/mypy or the repository's existing tools.
- Keep node functions small and testable.
- Avoid hidden global mutable state.
- Avoid broad `except Exception` unless it is immediately followed by typed error handling
  and either a re-raise or a clearly safe recovery.

## LangGraph design

- Define graph state explicitly with a typed schema.
- Keep nodes deterministic where possible.
- Separate prompt construction, model invocation, tool execution, validation, and state transitions.
- Validate node outputs before updating graph state.
- Model retry and fallback behavior explicitly.
- Make termination conditions explicit.
- Add timeouts and max-iteration guards to prevent runaway loops.

## A2A agent communication

- Treat other agents as untrusted boundaries.
- Validate every inbound and outbound agent message against a schema.
- Use typed message envelopes.
- Include correlation IDs, trace IDs, sender, receiver, purpose, timestamp, and schema
  version where appropriate.
- Enforce authentication/authorization before sensitive agent actions.
- Add idempotency for retried agent commands.
- Avoid free-form agent-to-agent commands for privileged operations.

## Tool safety

- Tool inputs must be schema validated.
- Tools must be allowlisted per agent.
- Tools that mutate data, call external services, send messages, or access secrets
  require explicit authorization and auditability.
- Destructive actions require human approval unless the product explicitly allows autonomy.

## Prompt and injection safety

- Do not let user, document, web, email, tool, or agent-provided text override
  system/developer/security instructions.
- Separate instructions from data.
- Quote or delimit untrusted content clearly.
- Never expose hidden prompts, credentials, tokens, or internal policies.
- Avoid placing secrets or full PII in prompts.

## Testing agents

- Unit test node logic.
- Integration test graph transitions.
- Mock LLM and tool calls for deterministic tests.
- Add regression tests for prompt-injection and unsafe tool-call scenarios.
- Add eval datasets for core agent behaviors where possible.

See `testing-quality-gates.md`.
