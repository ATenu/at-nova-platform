# Frontend: React + TypeScript

Standards for frontend code. The frontend improves usability; it is never a security
boundary. Backend authorization is always authoritative.

## TypeScript and components

- Use TypeScript strictly.
- Components must have explicit props types.
- Prefer composition and small components.
- Separate smart/container components from presentational components when complexity grows.
- Avoid large components that mix data fetching, formatting, authorization, rendering, and mutation logic.
- Avoid duplicating UI primitives; reuse shared components.
- Avoid unnecessary global state. Keep state as local as the use case allows.

## API access

- Use a single typed API client.
- Prefer generated clients from OpenAPI or shared contracts when available.
- Do not call `fetch`/`axios` directly throughout components.
- Centralize token attachment, request IDs, error normalization, retries, and timeout behavior in the client.
- Never treat frontend authorization checks as security controls.

## Keycloak frontend usage

- Use a centralized auth provider/hook.
- Store tokens according to the repository's chosen, reviewed approach.
- Do not scatter token parsing or role checks across components.
- UI may conditionally render based on permissions for usability, but backend authorization is mandatory.
- Handle login, logout, refresh, and expired sessions consistently in one place.

## Forms and validation

- Use schema-based validation aligned with backend contracts where possible.
- Validate before submit for usability.
- Treat backend validation as authoritative.
- Display safe, user-appropriate error messages (no internal detail).

## Security

- Avoid unsafe HTML rendering.
- If `dangerouslySetInnerHTML` is unavoidable, sanitize and document why.
- Avoid exposing sensitive data in local storage, logs, analytics, or errors.
- Respect CSP constraints.

## Accessibility and performance

- Use semantic HTML.
- Ensure keyboard navigation and proper labels.
- Avoid unnecessary re-renders.
- Use memoization only when it addresses a measured or obvious performance issue.
- Use code splitting for large routes/features when appropriate.
