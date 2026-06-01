# @nova/web

The Nova web frontend: a React + TypeScript single-page app that is the **presentation
layer** of the platform — an operations console (customers, products, sales, customer
issues, action queues, SOP workflows, RBAC admin) plus the **A2A agent chat** that
drives and visualizes asynchronous agent runs.

It is a standalone npm project (its own `package.json`, lockfile, `tsconfig`, ESLint,
and build tooling) and never imports server-only code. Built with Vite, React Router,
TanStack Query, React Hook Form, Zod, MSW, and the Keycloak JS adapter.

---

## 1. Role in the solution architecture

```text
Browser ── Keycloak JS (bearer JWT) ──► Keycloak
   │
   └── single typed http client (Bearer on every call) ──► @nova/api (VITE_API_BASE_URL)
            • RBAC-gated CRUD/list screens
            • POST /a2a/chat to start an agent run
            • authenticated fetch SSE: GET /agent-runs/:id/events  (live run trace)
```

- Talks **exclusively** to the Nova REST API at `VITE_API_BASE_URL`
  (default `http://localhost:3000/api/v1`) through one typed HTTP client.
- Authentication is owned by Keycloak (or a fully offline mock mode). The bearer token
  is attached to every API call.
- **The frontend is never an authorization authority.** It hides routes/buttons by
  permission for usability only; `@nova/api` enforces access on every request. The
  effective permission set comes from `GET /auth/me`, never from a decoded token.
- It never calls Keycloak Admin REST from the browser; user provisioning/sync is
  backend-driven.

---

## 2. Tech stack & dependencies

| Concern | Package |
|---|---|
| UI | `react` / `react-dom` 19 |
| Build / dev server | `vite` 8 + `@vitejs/plugin-react` |
| Routing | `react-router-dom` 7 |
| Server state | `@tanstack/react-query` 5 |
| Auth | `keycloak-js` 26 |
| Forms + validation | `react-hook-form` 7, `zod` 4, `@hookform/resolvers` |
| Dates / classnames | `date-fns`, `clsx` |
| Mock API (dev/test) | `msw` 2 |
| Testing | `vitest` 4, `@testing-library/*`, `jsdom` |

No Tailwind, axios, component library, or icon package — icons are inline SVGs
(`Icon.tsx`) and styling is custom CSS (`styles/global.css`, `layout.css`, `chat.css`).

---

## 3. Architecture

### Bootstrap chain

```text
main.tsx ── (if env.useMocks) start MSW worker ──► createRoot().render(<App/>)
  App.tsx ──► AppProviders ──► AppRouter
```

`AppProviders` (`app/providers.tsx`) composes, outer to inner: `QueryClientProvider`
(stable `createQueryClient()`), `BrowserRouter`, `ToastProvider`, `AuthProvider`.

### Folder conventions

| Directory | Role |
|---|---|
| `app/` | Root shell, providers, router |
| `auth/` | Keycloak, session abstraction, route guards, permission mirror |
| `api/` | `httpClient`, `queryClient`, `types`, per-domain `*.api.ts` |
| `components/layout/` | App shell, nav, page chrome, `PermissionGate` |
| `components/ui/` | Reusable primitives (Button, Table, Modal, …) |
| `features/` | Route-level screens by domain |
| `lib/` | Env, money, dates, errors, branding, zod helpers, `novaLinks` |
| `mocks/` | MSW handlers + fixtures (dev/test only) |
| `test/` | Vitest setup + `renderWithProviders` |
| `styles/` | Global, layout, chat CSS |

### Routing & layout (`app/router.tsx`)

`/login` (public) and `/logout`, with everything under `/app/*` wrapped in
`RequireAuth` → `AppShell` (responsive `Sidebar` + sticky `Topbar` + `<Outlet/>`).
Domain routes are individually guarded by `RequirePermission`:

| Path | Permission | Page |
|---|---|---|
| `/app` | — | `DashboardPage` |
| `/app/chat` | — | `AgentChatPage` |
| `/app/customers` | `read-customers` | `CustomersPage` |
| `/app/products` | `read-sales` | `ProductsPage` |
| `/app/sales`, `/sales/:id` | `read-sales` | `SalesPage`, `SaleDetailPage` |
| `/app/sales/new` | `write-sales` | `NewSalePage` |
| `/app/issues`, `/issues/:id` | `read-issues` | `IssuesPage`, `IssueDetailPage` |
| `/app/issues/new` | `create-issues` | `NewIssuePage` |
| `/app/actions` | `read-actions` | `ActionsPage` |
| `/app/sops`, `/sops/:id` | `read-sop` | `SopsPage`, `SopDetailPage` |
| `/app/sops/new`, `/sops/:id/edit` | `write-sop` | `SopEditorPage` |
| `/app/admin/users` | `read-users` | `AdminUsersPage` |
| `/app/admin/roles` | `read-permissions` | `RolesPermissionsPage` |

The `Sidebar` (`navigation.ts` → `NAV_GROUPS`) mirrors these routes, filtering items by
`canAny(...)`.

---

## 4. Authentication

- **`keycloak.ts`** — a single `keycloak` instance from env;
  `TOKEN_MIN_VALIDITY_SECONDS = 30` for proactive refresh.
- **`session.ts`** — chosen at module load: `createKeycloakSession()` (real) or
  `createMockSession()` (offline). The real session does
  `keycloak.init({ onLoad: 'check-sso', pkceMethod: 'S256', checkLoginIframe: false })`
  and `getToken()` calls `keycloak.updateToken(...)`. The mock session stores a chosen
  email in `sessionStorage` and issues `mock.{email}` tokens read by MSW.
- **`AuthProvider.tsx`** — registers the token provider with the HTTP client, runs
  `session.init()`, and when authenticated fetches `GET /auth/me` (TanStack Query,
  5-min stale). Exposes `login`, `loginAsMockUser`, `logout`, `refetchUser`, and the
  permission helpers `can` / `canAny` / `is`.
- **`tokenBridge.ts`** — decouples `httpClient` from Keycloak (`setTokenProvider`,
  `getAuthToken`, `notifyUnauthorized`). On an API 401 the client calls
  `notifyUnauthorized()` and the provider flips to `unauthenticated`.
- **Guards** — `RequireAuth` shows a loader during init and redirects unauthenticated
  users to `/login`; `RequirePermission` renders `ForbiddenPage` when
  `!canAny(anyOf)`.
- **`permissions.ts`** — a static mirror of backend RBAC (`NOVA_ROLES`,
  `NOVA_PERMISSIONS`, `ROLE_PERMISSIONS`, `EXPECTED_ROLE_PERMISSION_COUNT = 39`) used
  only for labels/helpers; effective permissions at runtime always come from `/auth/me`.
- **`demoUsers.ts`** — the five seeded users (`admin@`, `salesman@`, `opsman@`,
  `compliance@`, `crm@`) for the mock login picker.

---

## 5. API layer

- **`httpClient.ts`** — a single `http` object (`get/post/put/patch/delete`) that builds
  URLs from `env.apiBaseUrl`, injects `Authorization: Bearer {token}` (unless
  `anonymous`), sets JSON content type, supports custom headers (e.g.
  `Idempotency-Key`), normalizes errors into `ApiError` (RFC 7807 `problem+json`),
  handles 204/network failures, and calls `notifyUnauthorized()` on 401. Feature code
  must not call `fetch` directly (the one exception is the SSE hook, which also uses an
  authenticated fetch).
- **`queryClient.ts`** — centralized `queryKeys` and `createQueryClient` (30s
  `staleTime`, 5-min `gcTime`, no refetch on focus, no retry on 4xx).
- **`types.ts`** — camelCase DTO mirrors (money as strings) including the agent-run
  types (`AgentRunStatus`, `TERMINAL_AGENT_RUN_STATUSES`, `AgentRunDto`,
  `AgentRunEventDto`, `AgentRunTraceDto`, `CreateAgentRunRequest`).
- **Per-domain modules** — `auth`, `chat`, `agentRuns`, `admin`, `customers`,
  `products`, `sales`, `issues`, `actions`, `sops` (`*.api.ts`). `agentRuns.api.ts`
  exposes `createAgentRun`, `getAgentRun`, `cancelAgentRun`,
  `getAgentRunTrace(runId, detail)`, `listConversationRuns`, and
  `newIdempotencyKey() = crypto.randomUUID()`.

---

## 6. Agentic chat feature (deep)

The chat feature is the heart of the UI and the consumer of the agent-run SSE stream.

### `AgentChatPage.tsx`

Tracks the active conversation (`?c={id}`), the active `runId`, an optimistic `pending`
user message, and a `detailed` toggle. **Send flow:** the composer calls
`createAgentRun({ message, conversationId?, context }, newIdempotencyKey())`; on success
it clears `pending`, sets `runId`, and invalidates the conversation list (updating `?c=`
for new conversations). While a run is active it renders an assistant bubble containing
`LiveRunTrace`; on completion it seeds the TanStack cache for the run trace from the
live SSE buffer and invalidates the conversation so the persisted assistant message
appears. System messages are filtered out of the thread.

### `useAgentRunEvents.ts` (SSE subscription)

`EventSource` cannot send an `Authorization` header, so the hook uses an authenticated
`fetch` to `{apiBaseUrl}/agent-runs/{runId}/events?afterSequence={cursor}` (adding
`&detail=full` when detailed) with `Accept: text/event-stream` and a `Last-Event-ID`
header when resuming. It runs a manual SSE frame parser, de-dupes events by id, tracks
the max `sequence`, detects terminal events
(`run.completed`/`failed`/`canceled`/`expired`), and reconnects with exponential
backoff (500ms → max 10s) until terminal or unmount. It returns
`{ events, isStreaming, isComplete, error }`.

### `traceModel.ts` (events → trace view)

`describeEvent()` maps ~40 event types to human-readable lines (kinds `tool` / `agent`
/ `lifecycle`), with a `technical` flag for low-level events (`agent.schema.*`,
`agent.query.*`, `agent.read/write.*`, `agent.node.*`, `agent.authz.*`, authz events).
`buildTraceView(events, detailed)` groups `tool.call.*` and `agent.call.*` into merged
invocations with status/input/output, nests agent-internal events as substeps, and
keeps lifecycle events separate. `summarizeEvents` produces labels like
`"2 tools · 1 agent"`. All IO is rendered as plain text (`JSON.stringify`), never HTML.

### Rendering & links

`RunTrace.tsx` provides `LiveRunTrace` (collapsible "Activity" header + summary badge +
optional technical-detail toggle + typing indicator) and `RunTracePanel` (lazy-loads
the persisted trace for historical messages). `ChatMessage.tsx` renders role bubbles as
plain text, optionally with an `McpAppLinkCard` and tool links. `McpAppLinkCard.tsx` +
`novaLinks.ts` resolve `nova://` deep links to in-app routes (`nova://sales/{id}` →
`/app/sales/{id}`, `nova://issues/{id}`, `nova://customers/{id}`, `nova://actions/{id}`,
`nova://sops/{id}`, `nova://roles/{id}`); unknown links show an "Unsupported link"
badge and are never auto-followed.

### Detail levels

The default ("user") view shows only `user`-visibility events; toggling **detailed**
re-subscribes from sequence 0 with `detail=full` to backfill graph-node execution and
authz decisions (owner-only, enforced server-side). Cache seeding matches the detail
level so the user view is never seeded with technical events.

---

## 7. Feature modules

| Feature | Route(s) | What it does | Gating |
|---|---|---|---|
| Dashboard | `/app` | Permission-aware stat cards + recent lists; per-domain queries enabled by `can('read-*')` | query-level |
| Agent Chat | `/app/chat` | Conversations + thread + composer + live/historical run traces | any authenticated |
| Customers | `/app/customers` | Searchable paginated directory | route `read-customers` |
| Products | `/app/products` | Read-only catalog list | route `read-sales` |
| Sales | `/app/sales`, `/:id`, `/new` | List/detail; create form (RHF+Zod, line items, `computeSaleTotals`) | route + `PermissionGate write-sales` |
| Issues | `/app/issues`, `/:id`, `/new` | List/detail with edit modal + embedded `ActionCard`s; create | `PermissionGate create-issues`; edits need `write-issues` |
| Actions | `/app/actions` | Status-grouped cards; transitions, dependency blocking, comments | route `read-actions`; writes need `write-actions` |
| SOPs | `/app/sops`, `/:id`, `/new`, `/edit` | List/detail with version history; editor creates new immutable versions | `PermissionGate write-sop` |
| Admin Users | `/app/admin/users` | User table, Keycloak sync badges, create/role-assignment modals | route `read-users`; `PermissionGate write-users` |
| Roles & Permissions | `/app/admin/roles` | Read-only RBAC matrix; verifies grant count vs `EXPECTED_ROLE_PERMISSION_COUNT` | route `read-permissions` |
| Auth / Misc | `/login`, `/logout` | Mock picker or Keycloak redirect; `ForbiddenPage`, `NotFoundPage` | public login |

Forms using React Hook Form + Zod: `NewSalePage`, `NewIssuePage`, `SopEditorPage`,
`UserFormModal`.

---

## 8. UI component library (`components/ui/*`)

`Avatar`, `Badge`, `Button` (variants `primary`/`secondary`/`ghost`/`danger`), `Card`,
`FormField`/`TextInput`/`TextArea`/`Select`, `Icon` (30+ inline SVGs), `Modal`,
`Pagination`, `SearchInput`, `StatCard`, `StatusBadge` (domain status badges),
`states.tsx` (`LoadingState`/`EmptyState`/`ErrorState`/`TableSkeleton`), `Table`
(`DataTable`), and `toast` (`ToastProvider`/`useToast`). Layout components (outside
`ui/`): `AppShell`, `Sidebar`, `Topbar`, `Breadcrumbs`, `PageHeader`, `AppBrand`,
`FullScreenState`, `PermissionGate`.

---

## 9. Configuration & environment

`lib/env.ts` reads `import.meta.env` once into a typed `AppEnv`:

| Variable | Purpose | Default |
|---|---|---|
| `VITE_API_BASE_URL` | Nova API base | `http://localhost:3000/api/v1` |
| `VITE_KEYCLOAK_URL` | Keycloak base | `http://localhost:8080` |
| `VITE_KEYCLOAK_REALM` | Realm | `nova` |
| `VITE_KEYCLOAK_CLIENT_ID` | Public client id | `nova-frontend` |
| `VITE_APP_NAME` | Display name | `Nova` |
| `VITE_USE_MOCKS` | Offline mock API + auth | `true` in dev, forced `false` in production builds |

Only `VITE_`-prefixed values are exposed, and those are public client config only — no
secrets in the bundle.

---

## 10. Mock mode & testing

Set `VITE_USE_MOCKS=true` and `npm run dev` to boot a fully offline app: MSW
(`mocks/handlers.ts` + `mocks/fixtures.ts`, seeded to mirror the backend) plus a mock
auth session with a login picker. `POST /a2a/chat` returns 202 with scripted events
that the mock SSE handler replays. The mock worker is dynamically imported, so it is
never loaded in a production build.

Vitest tests cover `permissions` (including the 39-grant count), `httpClient` (bearer
injection + error normalization), `Sidebar` visibility per demo user, `traceModel`
(tool/agent merging, technical filtering, summaries), `novaLinks` (all mappings), and
`money` helpers. `test/setup.ts` wires the MSW server; `renderWithProviders` +
`signInAs(email)` set up a logged-in render.

---

## 11. Scripts

```bash
npm install        # uses the committed package-lock.json
npm run dev        # Vite dev server on http://localhost:5173
npm run typecheck  # tsc, no emit
npm run lint       # eslint
npm test           # vitest (unit + integration with MSW)
npm run build      # type-check then production build to dist/
npm run preview    # preview the production build locally
```

`vite.config.ts` aliases `@` → `./src`, fixes the dev port to 5173, and configures
Vitest (`globals`, `jsdom`, `setupFiles`).

---

## 12. Local Keycloak + seeded users

The repository root `docker compose up --build` starts Postgres, the API, Keycloak
(with the `nova` realm imported), and this web app. Keycloak is on
http://localhost:8080 (admin console `admin` / `admin`, local only). The realm import
seeds the demo users with a **temporary** password `ChangeMe123!` (forced change on
first login), mirroring the database seed roles:

| Email | Role |
|---|---|
| `admin@test.com` | `admin` |
| `salesman@test.com` | `sales-user` |
| `opsman@test.com` | `support-operations-user` |
| `compliance@test.com` | `ops-compliance` |
| `crm@test.com` | `customer-support` |

These dev credentials are never stored in the application database.

---

## 13. Docker

Built and served as static assets by nginx via `frontend/web/Dockerfile` (Node 22
build stage → nginx 1.27 runtime; SPA fallback to `index.html`, long-cache `/assets/`).
`VITE_*` values are inlined at build time (with `VITE_USE_MOCKS=false` hardcoded for
images); override via build args / root `.env`. See the root `docker-compose.yml` `web`
service (published on host port `5173` to match realm redirect URIs).

---

## 14. File map (selected)

| Path | Description |
|---|---|
| `src/main.tsx` / `app/App.tsx` / `app/providers.tsx` / `app/router.tsx` | Bootstrap, root, providers, routes |
| `src/auth/keycloak.ts` / `session.ts` / `tokenBridge.ts` / `AuthProvider.tsx` | Auth core |
| `src/auth/RequireAuth.tsx` / `RequirePermission.tsx` / `permissions.ts` / `demoUsers.ts` | Guards + RBAC mirror |
| `src/api/httpClient.ts` / `queryClient.ts` / `types.ts` / `*.api.ts` | API layer |
| `src/features/chat/AgentChatPage.tsx` / `useAgentRunEvents.ts` / `traceModel.ts` / `RunTrace.tsx` | Agent chat + SSE trace |
| `src/features/chat/ChatMessage.tsx` / `ChatComposer.tsx` / `McpAppLinkCard.tsx` | Chat UI |
| `src/features/{dashboard,customers,products,sales,issues,actions,sops,admin,auth,misc}/` | Feature screens |
| `src/components/layout/*` / `components/ui/*` | Shell + primitives |
| `src/lib/{env,errors,money,dates,branding,novaLinks,zod}.ts` | Cross-cutting helpers |
| `src/mocks/*` / `src/test/*` | MSW + test infra |

---

## 15. Keycloak usage (validated against the code)

The frontend is a **public OIDC client** of Keycloak. It uses Keycloak to obtain and
refresh the user's bearer token, and attaches that token to API calls — but it is never
an authorization authority and never decodes the token for access decisions.

### Adapter (`auth/keycloak.ts`)

A single `new Keycloak({ url: env.keycloakUrl, realm: env.keycloakRealm, clientId:
env.keycloakClientId })` instance (from `VITE_KEYCLOAK_URL` / `_REALM` / `_CLIENT_ID`,
defaults `http://localhost:8080` / `nova` / `nova-frontend`). Tokens are held in adapter
memory only — never written to `localStorage` by the app.

### Session lifecycle (`auth/session.ts`)

`createKeycloakSession` (selected when `env.useMocks` is false):

- `init()` → `keycloak.init({ onLoad: 'check-sso', pkceMethod: 'S256',
  checkLoginIframe: false })` — PKCE (S256) authorization-code flow, with `check-sso`
  so the branded `/login` page can render before redirecting.
- `login()` → `keycloak.login()`; `logout()` → `keycloak.logout({ redirectUri:
  window.location.origin })`.
- `getToken()` → `keycloak.updateToken(TOKEN_MIN_VALIDITY_SECONDS)` (proactive refresh
  at 30s remaining), returning `keycloak.token`.

### Token attachment & authz boundary

`AuthProvider` registers `session.getToken` with the `tokenBridge`, so `httpClient`
injects `Authorization: Bearer <token>` on every request and calls `notifyUnauthorized`
on a 401. The user's **effective roles/permissions come from `GET /auth/me`**, not from
the decoded JWT — `permissions.ts` is only a static mirror for labels/UI gating. The
browser never calls the Keycloak Admin REST API (user management is backend-driven via
`admin.api.ts` → `@nova/api`).

### Mock mode

When `VITE_USE_MOCKS=true` (dev/test only; forced `false` in production builds),
`createMockSession` bypasses Keycloak entirely and issues a non-cryptographic
`mock.{email}` token that MSW reads. This path never runs in deployed builds.

Files: `auth/keycloak.ts`, `auth/session.ts`, `auth/AuthProvider.tsx`,
`auth/tokenBridge.ts`, `lib/env.ts`.
