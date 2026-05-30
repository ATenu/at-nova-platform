# Observability and Langfuse

Make systems debuggable without leaking sensitive data.

## Cross-application observability

- Every request/operation has a correlation ID.
- Logs, traces, metrics, and errors are linkable through that ID.
- Use structured logging (key/value, not interpolated prose).
- Never log secrets, tokens, credentials, PII, or raw prompts unless explicitly allowed and redacted.

## Backend observability

- Log auth failures, permission denials, validation failures, and unexpected errors safely.
- Instrument database latency and external calls.
- Include route ID and policy ID for authorization decisions where safe.
- Distinguish expected denials (401/403) from unexpected server errors (5xx) in metrics.

## Langfuse observability

- Instrument LangGraph agent runs with traces/spans.
- Capture model, prompt version, tool calls, latency, token usage, and outcome metadata.
- Redact sensitive inputs and outputs before they reach Langfuse.
- Do not send secrets or unnecessary PII to Langfuse.
- Use Langfuse metadata for: correlation IDs, tenant IDs (only when policy allows),
  environment, version, and evaluation labels.
- Track eval results and regression outcomes.

## Redaction checklist

Before emitting any log or trace, confirm none of these appear in plaintext:

- Bearer tokens, refresh tokens, authorization headers, cookies.
- API keys, client secrets, database credentials.
- Full PII (emails, names, identifiers) beyond what policy permits.
- Raw user prompts or completions when policy restricts them.
