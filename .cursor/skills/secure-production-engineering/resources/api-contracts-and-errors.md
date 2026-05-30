# API Contracts and Errors

Standards for API contracts. Adapt to the repository's existing standard if present.

## Contracts

- Use OpenAPI or the repository's existing API contract approach.
- Contracts include auth requirements, request schemas, response schemas, and error responses.
- Use stable DTOs instead of raw entities.
- Version APIs intentionally.
- Use consistent pagination, filtering, and sorting patterns.
- Use consistent error envelopes.
- Avoid leaking internal implementation details.
- Document permissions/scopes for each route.
- Add contract tests when route behavior changes.

## Preferred error shape

RFC 7807-style problem response with stable machine-readable fields:

```ts
type ApiErrorResponse = {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code: string;
  correlationId: string;
};
```

- `type`/`title`/`status`/`detail`/`instance` follow RFC 7807.
- `code` is a stable, documented machine-readable error code.
- `correlationId` links the error to logs and traces.
- Never include stack traces, ORM errors, or internal URLs.

Adapt field names to an existing repository standard if one is established, but keep
the envelope consistent across the whole API.
