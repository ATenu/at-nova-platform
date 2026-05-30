# frontend

React + TypeScript web application(s) for the Nova platform. Each app is its own
npm workspace and a direct child of this folder (e.g. `frontend/web`,
`frontend/admin`).

## Conventions

- React + TypeScript, strongly typed; no `any`.
- The frontend is **never** an authorization authority. It may hide UI, but the
  backend (`backend-services/api`) enforces all access. Send Keycloak bearer
  tokens; let the API validate them.
- This folder owns its own npm configuration, independent of
  `backend-services/`. Do not import server-only code (TypeORM, Node APIs) into
  the browser bundle.
- Each app owns its build tooling (e.g. Vite) and its own `tsconfig.json`.

## Scaffolding the first app

1. Create `frontend/web/` with `package.json` (`@nova/web`), the chosen build
   tool, and `src/`.
2. Run `npm install` from the repo root to link the new workspace.
