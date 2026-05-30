# Security by Design

Complete secure-coding policy. Security is default-deny and centralized. When in
doubt, fail closed.

## Security defaults

- Default deny.
- Least privilege.
- Defense in depth.
- Explicit allowlists over denylists.
- Validate all inputs at trust boundaries.
- Encode outputs appropriately for their sink (HTML, SQL, shell, URL, log).
- Never trust frontend state, request bodies, headers, cookies, query params, or agent-provided text.
- Never leak stack traces, tokens, secrets, PII, internal URLs, infrastructure details, or the permission model.

## Authentication

- Keycloak is the identity provider and bearer token issuer.
- The backend validates bearer tokens using a single centralized authentication component.
- Validate issuer, audience, expiration (`exp`), not-before (`nbf`), algorithm, signature, and required claims.
- Use JWKS with safe caching and key-rotation handling.
- Reject unsigned tokens (`alg: none`) and any unexpected algorithm.
- Reject tokens missing required claims.
- Normalize the authenticated principal into a typed `AuthContext` (see `auth-keycloak-rbac.md`).
- Never decode a JWT without validation and then use its claims for an authorization decision.

## Authorization

- Enforce centralized RBAC and scope checks for every protected route.
- Use typed permission definitions, not raw role strings scattered across code.
- Authorization is performed on the backend. The frontend never makes the final decision.
- Route metadata declares the required permission/scope.
- Missing route metadata on a protected route must fail closed.
- Public routes must be explicitly marked public and reviewed.
- Role checks must use domain permissions, not scattered raw Keycloak role strings.
- Support tenant/org/project-level constraints where applicable.
- Audit sensitive authorization decisions.

## Secrets

- Secrets come from a secret manager or validated environment configuration only.
- Never log secrets, tokens, cookies, authorization headers, refresh tokens, API keys, private prompts, or credentials.
- Redact sensitive values in logs and Langfuse metadata before they are emitted.

## Web / API hardening

- Enforce restrictive CORS (explicit allowlist of origins, methods, headers).
- Use secure response headers.
- Apply request body size limits.
- Apply rate limiting and abuse controls to sensitive endpoints.
- Use idempotency keys for high-risk mutating operations when appropriate.
- Use CSRF protection where cookie-based auth is introduced.
- Return consistent error shapes (see `api-contracts-and-errors.md`).
- Do not expose internal exception details to clients.

## Agent security

- Treat LLM inputs and tool outputs as untrusted.
- Validate tool inputs with schemas.
- Allowlist tools per agent and per use case.
- Add authorization checks before tools perform sensitive actions.
- Prevent prompt injection from overriding system, security, or authorization rules.
- Never put secrets in prompts, traces, tool responses, or Langfuse-visible fields.
- Redact PII and secrets from traces.
- Add human approval gates for destructive or externally visible actions.

## Data protection

- Classify sensitive data (secrets, PII, regulated data).
- Log the minimum required data.
- Avoid unnecessary persistence of prompts, completions, and user data.
- Define retention expectations for sensitive data.
- Use encryption in transit and at rest.
