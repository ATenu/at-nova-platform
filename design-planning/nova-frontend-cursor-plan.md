# Cursor Prompt: Build the Nova Frontend for A2A Agent Chat, RBAC, Keycloak, Admin, SOP, Sales, and Customer Issue Workflows

You are working in the Nova application repository. A backend database layer already exists or is being implemented from the attached backend plan. Build a production-ready React + TypeScript frontend that works with that backend and with Keycloak authentication.

This prompt is self-contained for frontend development. First inspect the existing repository, package manager, framework conventions, API routes, environment files, Docker setup, and generated types if present. Adapt the implementation to the current project instead of blindly replacing existing code.

Do **not** implement passwords in the application database. PostgreSQL users are application profile records only. Authentication belongs to Keycloak.

---

## 1. Product Goal

Build a complete Nova frontend that lets authenticated users work according to their role and permissions:

1. All logged-in users can access a secure app shell.
2. All logged-in users can use a chat interface to talk with Nova A2A agents.
3. Admin users can manage:
   - users,
   - roles,
   - permissions,
   - user-role assignments,
   - Keycloak provisioning/synchronization status.
4. Compliance users can:
   - create new SOPs,
   - modify existing SOPs by creating new SOP detail versions,
   - view SOP history.
5. Sales users can:
   - register new sales,
   - view customers,
   - view products,
   - view sales history,
   - view related issues and actions read-only.
6. Customer support users can:
   - create new customer issues,
   - update customer issues,
   - update issue actions,
   - add action comments.
7. Support operations users can:
   - update issue actions,
   - add action comments,
   - update operational issue/action status where permitted,
   - **not** create new customer issues because they do not have `create-issues`.
8. The UI must hide inaccessible screens and actions, but the backend remains the source of truth for authorization.

---

## 2. Required Tech Stack

Use the existing frontend stack if already present. If a frontend does not exist, create it using:

- React
- TypeScript
- Vite
- React Router
- TanStack Query
- Zod
- React Hook Form
- Keycloak JS adapter
- A typed API client around `fetch` or `axios`
- A simple component system using the existing project styling conventions

Recommended packages if not already installed:

```bash
npm install react-router-dom @tanstack/react-query zod react-hook-form @hookform/resolvers keycloak-js axios date-fns clsx
npm install -D vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event msw
```

If the repo uses pnpm, yarn, Next.js, Remix, or another framework, adapt the commands and file layout.

---

## 3. Backend Domain Source of Truth

The backend plan defines these PostgreSQL tables and entities:

- `users`
- `roles`
- `permissions`
- `user_roles`
- `role_permissions`
- `customers`
- `products`
- `sales`
- `products_sold`
- `customer_issues`
- `issue_actions`
- `issue_action_dependencies`
- `action_comments`
- `sops`
- `sop_details`
- `conversations`
- `messages`

Important backend rules that the frontend must respect:

- No `password`, `passwordHash`, or password-related field exists in `users`.
- Authentication is handled by Keycloak.
- Money values are returned as strings because PostgreSQL `numeric` should not be treated as floating point.
- PostgreSQL columns use `snake_case`, but frontend TypeScript should use `camelCase`.
- The backend seed uses deterministic users, roles, permissions, customers, products, sales, issues, actions, SOPs, conversations, and messages.

---

## 4. Seeded Users, Roles, and Permissions

Use the following data to create local UI fixtures, seed-aware tests, and Keycloak seed scripts.

### 4.1 Seeded Application Users

These users exist in the application database:

| Email | First name | Last name | Role | Description |
|---|---|---|---|---|
| `admin@test.com` | admin | admin | `admin` | super admin users and system admin |
| `salesman@test.com` | sales | man | `sales-user` | sales team |
| `opsman@test.com` | ope | man | `support-operations-user` | operations and maintenance team |
| `compliance@test.com` | compliance | ops | `ops-compliance` | compliance team |
| `crm@test.com` | customer | support | `customer-support` | customer support team |

### 4.2 Roles

```ts
export const NOVA_ROLES = [
  'sales-user',
  'support-operations-user',
  'admin',
  'customer-support',
  'ops-compliance',
] as const;
```

### 4.3 Permissions

```ts
export const NOVA_PERMISSIONS = [
  'read-customers',
  'write-customers',
  'create-issues',
  'read-issues',
  'write-issues',
  'read-sales',
  'write-sales',
  'read-permissions',
  'write-permissions',
  'read-actions',
  'write-actions',
  'read-sop',
  'write-sop',
  'read-users',
  'write-users',
] as const;
```

### 4.4 Role-Permission Mapping

```ts
export const ROLE_PERMISSIONS: Record<string, string[]> = {
  'sales-user': [
    'read-customers',
    'write-customers',
    'read-issues',
    'read-sales',
    'write-sales',
    'read-actions',
    'read-sop',
  ],
  'support-operations-user': [
    'read-customers',
    'write-customers',
    'read-issues',
    'write-issues',
    'read-sales',
    'read-actions',
    'write-actions',
    'read-sop',
  ],
  admin: [
    'read-customers',
    'write-customers',
    'create-issues',
    'read-issues',
    'write-issues',
    'read-sales',
    'write-sales',
    'read-permissions',
    'write-permissions',
    'read-actions',
    'write-actions',
    'read-sop',
    'write-sop',
    'read-users',
    'write-users',
  ],
  'ops-compliance': [
    'read-sop',
    'write-sop',
  ],
  'customer-support': [
    'read-customers',
    'create-issues',
    'read-issues',
    'write-issues',
    'read-sales',
    'read-actions',
    'write-actions',
  ],
};
```

Expected `role_permissions` count after clean DB seeding: `39`.

---

## 5. Authorization Model

Implement a frontend authorization layer with these principles:

1. Keycloak authenticates users and provides access tokens.
2. The frontend sends `Authorization: Bearer <token>` to the backend.
3. The frontend fetches the current application user profile from the backend.
4. The backend returns effective application roles and permissions from the database.
5. Frontend route visibility and button visibility use these effective permissions.
6. Never rely on frontend checks for real authorization. The backend must still enforce all permissions.

### 5.1 Required Current User Shape

Ask the backend for a `/auth/me` or equivalent endpoint. If the endpoint does not exist, add a frontend service interface and a clear TODO for the backend.

Expected shape:

```ts
export interface CurrentUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  middleName?: string | null;
  description?: string | null;
  roles: string[];
  permissions: string[];
}
```

### 5.2 Authorization Helpers

Create helpers similar to:

```ts
export function hasPermission(user: CurrentUser | null, permission: NovaPermission): boolean {
  return Boolean(user?.permissions.includes(permission));
}

export function hasAnyPermission(user: CurrentUser | null, permissions: NovaPermission[]): boolean {
  return permissions.some((permission) => hasPermission(user, permission));
}

export function hasRole(user: CurrentUser | null, role: NovaRole): boolean {
  return Boolean(user?.roles.includes(role));
}
```

Use these helpers in:

- route guards,
- sidebar navigation,
- page-level action buttons,
- table row action buttons,
- form submission permissions.

---

## 6. Route Map

Implement these routes. Adapt path prefixes if the existing app already has conventions.

| Route | Page | Required permission |
|---|---|---|
| `/login` | Login redirect/helper page | none |
| `/logout` | Logout redirect/helper page | authenticated |
| `/app` | Dashboard | authenticated |
| `/app/chat` | A2A Agent Chat | authenticated |
| `/app/admin/users` | User management | `read-users` |
| `/app/admin/roles` | Roles and permissions | `read-permissions` |
| `/app/customers` | Customer list | `read-customers` |
| `/app/products` | Product catalogue | authenticated or `read-sales` |
| `/app/sales` | Sales list | `read-sales` |
| `/app/sales/new` | Register sale | `write-sales` |
| `/app/issues` | Customer issue list | `read-issues` |
| `/app/issues/new` | Create issue | `create-issues` |
| `/app/issues/:id` | Issue details and actions | `read-issues` |
| `/app/actions` | Issue action work queue | `read-actions` |
| `/app/sops` | SOP list | `read-sop` |
| `/app/sops/new` | Create SOP | `write-sop` |
| `/app/sops/:id` | SOP details and version history | `read-sop` |
| `/app/sops/:id/edit` | Create/edit SOP version | `write-sop` |

### 6.1 Role-Specific UX

The app shell must show navigation based on permissions:

- Admin:
  - Dashboard
  - Chat
  - Admin: Users
  - Admin: Roles & Permissions
  - Customers
  - Products
  - Sales
  - Issues
  - Actions
  - SOPs
- Sales:
  - Dashboard
  - Chat
  - Customers
  - Products
  - Sales
  - Issues read-only
  - Actions read-only
  - SOPs read-only
- Support operations:
  - Dashboard
  - Chat
  - Customers
  - Sales read-only
  - Issues
  - Actions
  - SOPs read-only
- Compliance:
  - Dashboard
  - Chat
  - SOPs
- Customer support:
  - Dashboard
  - Chat
  - Customers read-only
  - Sales read-only
  - Issues
  - Actions

---

## 7. Frontend File Structure

Create or adapt this structure:

```text
src/
  app/
    App.tsx
    router.tsx
    providers.tsx
  auth/
    keycloak.ts
    AuthProvider.tsx
    RequireAuth.tsx
    RequirePermission.tsx
    permissions.ts
    useCurrentUser.ts
  api/
    httpClient.ts
    queryClient.ts
    types.ts
    auth.api.ts
    admin.api.ts
    customers.api.ts
    products.api.ts
    sales.api.ts
    issues.api.ts
    actions.api.ts
    sops.api.ts
    chat.api.ts
  components/
    layout/
      AppShell.tsx
      Sidebar.tsx
      Topbar.tsx
      PermissionGate.tsx
    ui/
      Button.tsx
      Card.tsx
      EmptyState.tsx
      ErrorState.tsx
      LoadingState.tsx
      Modal.tsx
      Table.tsx
      Badge.tsx
      FormField.tsx
  features/
    dashboard/
      DashboardPage.tsx
    chat/
      AgentChatPage.tsx
      ConversationList.tsx
      ChatWindow.tsx
      ChatMessage.tsx
      ChatComposer.tsx
      McpAppLinkCard.tsx
    admin/
      AdminUsersPage.tsx
      UserForm.tsx
      RoleAssignmentEditor.tsx
      RolesPermissionsPage.tsx
      KeycloakSyncPanel.tsx
    customers/
      CustomersPage.tsx
      CustomerDetailPanel.tsx
    products/
      ProductsPage.tsx
    sales/
      SalesPage.tsx
      NewSalePage.tsx
      SaleForm.tsx
      SaleItemsEditor.tsx
      SaleReceiptSummary.tsx
    issues/
      IssuesPage.tsx
      NewIssuePage.tsx
      IssueDetailPage.tsx
      IssueForm.tsx
      IssueActionsTimeline.tsx
    actions/
      ActionsPage.tsx
      ActionStatusEditor.tsx
      ActionComments.tsx
      ActionDependencies.tsx
    sops/
      SopsPage.tsx
      SopDetailPage.tsx
      SopEditorPage.tsx
      SopVersionHistory.tsx
  lib/
    dates.ts
    money.ts
    errors.ts
    env.ts
    zod.ts
  test/
    handlers.ts
    renderWithProviders.tsx
```

---

## 8. Environment Variables

Create or update `.env.example` for the frontend:

```env
VITE_API_BASE_URL=http://localhost:3000/api

VITE_KEYCLOAK_URL=http://localhost:8080
VITE_KEYCLOAK_REALM=nova
VITE_KEYCLOAK_CLIENT_ID=nova-frontend

VITE_APP_NAME=Nova
```

Never put Keycloak admin credentials or backend service secrets in frontend environment variables.

---

## 9. Keycloak Frontend Integration

Use the Keycloak JS adapter.

Create `src/auth/keycloak.ts`:

```ts
import Keycloak from 'keycloak-js';

export const keycloak = new Keycloak({
  url: import.meta.env.VITE_KEYCLOAK_URL,
  realm: import.meta.env.VITE_KEYCLOAK_REALM,
  clientId: import.meta.env.VITE_KEYCLOAK_CLIENT_ID,
});
```

Initialize with:

- `onLoad: 'login-required'` for app routes,
- PKCE method `S256`,
- token refresh before expiry,
- clear user state on logout.

Example behavior:

```ts
await keycloak.init({
  onLoad: 'login-required',
  pkceMethod: 'S256',
  checkLoginIframe: false,
});
```

Add an Axios/fetch interceptor:

```ts
Authorization: Bearer ${keycloak.token}
```

Before each API request, refresh token if needed:

```ts
await keycloak.updateToken(30);
```

If refresh fails, redirect to login.

---

## 10. Keycloak Realm Configuration

Create a local Keycloak realm named `nova`.

### 10.1 Realm

- Realm name: `nova`
- Display name: `Nova`
- Login with email: enabled
- Duplicate emails: disabled
- Email as username: recommended for this app
- User registration: disabled unless explicitly needed
- Verify email: optional in local dev, recommended in production
- Reset password: enabled

### 10.2 Frontend Client

Create a client:

| Setting | Value |
|---|---|
| Client ID | `nova-frontend` |
| Client type | OpenID Connect |
| Client authentication | Off |
| Authorization | Off |
| Standard flow | On |
| Direct access grants | Off unless needed for local test automation |
| Valid redirect URIs | `http://localhost:5173/*` |
| Valid post logout redirect URIs | `http://localhost:5173/*` |
| Web origins | `http://localhost:5173` |

Use stricter production redirect URIs and web origins.

### 10.3 Backend/API Client

Create a client:

| Setting | Value |
|---|---|
| Client ID | `nova-api` |
| Client type | OpenID Connect |
| Client authentication | On if backend needs service credentials |
| Standard flow | Off unless needed |
| Direct access grants | Off unless needed |
| Service accounts | On only if backend needs admin/service calls |

The backend should validate bearer access tokens from the `nova` realm. The frontend must never call Keycloak Admin REST APIs directly.

### 10.4 Keycloak Roles

Create realm roles matching the DB roles:

```text
admin
sales-user
support-operations-user
customer-support
ops-compliance
```

Assign the same role to each Keycloak user as the DB seed assigns in `user_roles`.

### 10.5 Keycloak Users

Create these Keycloak users with the same email, first name, last name, and role as the DB seed:

```ts
export const KEYCLOAK_USERS = [
  {
    username: 'admin@test.com',
    email: 'admin@test.com',
    firstName: 'admin',
    lastName: 'admin',
    realmRoles: ['admin'],
  },
  {
    username: 'salesman@test.com',
    email: 'salesman@test.com',
    firstName: 'sales',
    lastName: 'man',
    realmRoles: ['sales-user'],
  },
  {
    username: 'opsman@test.com',
    email: 'opsman@test.com',
    firstName: 'ope',
    lastName: 'man',
    realmRoles: ['support-operations-user'],
  },
  {
    username: 'compliance@test.com',
    email: 'compliance@test.com',
    firstName: 'compliance',
    lastName: 'ops',
    realmRoles: ['ops-compliance'],
  },
  {
    username: 'crm@test.com',
    email: 'crm@test.com',
    firstName: 'customer',
    lastName: 'support',
    realmRoles: ['customer-support'],
  },
] as const;
```

For local development only, Keycloak can seed temporary credentials. Do **not** store or copy these credentials into PostgreSQL. Prefer `temporary: true` and `requiredActions: ['UPDATE_PASSWORD']`.

---

## 11. Keycloak Realm Import File

Create a local-only file such as:

```text
infra/keycloak/nova-realm.dev.json
```

Implement a realm import compatible with the Keycloak container import flow.

The import must include:

- realm `nova`,
- roles,
- `nova-frontend` client,
- optional `nova-api` client,
- users,
- role assignments.

Use a safe local development pattern:

```json
{
  "realm": "nova",
  "enabled": true,
  "loginWithEmailAllowed": true,
  "duplicateEmailsAllowed": false,
  "registrationAllowed": false,
  "resetPasswordAllowed": true,
  "roles": {
    "realm": [
      { "name": "admin", "description": "super admin users and system admin" },
      { "name": "sales-user", "description": "sales team" },
      { "name": "support-operations-user", "description": "operations team" },
      { "name": "customer-support", "description": "customer support team" },
      { "name": "ops-compliance", "description": "compliance team" }
    ]
  },
  "clients": [
    {
      "clientId": "nova-frontend",
      "name": "Nova Frontend",
      "enabled": true,
      "publicClient": true,
      "protocol": "openid-connect",
      "standardFlowEnabled": true,
      "directAccessGrantsEnabled": false,
      "redirectUris": ["http://localhost:5173/*"],
      "webOrigins": ["http://localhost:5173"],
      "attributes": {
        "pkce.code.challenge.method": "S256"
      }
    },
    {
      "clientId": "nova-api",
      "name": "Nova API",
      "enabled": true,
      "publicClient": false,
      "protocol": "openid-connect",
      "standardFlowEnabled": false,
      "directAccessGrantsEnabled": false,
      "serviceAccountsEnabled": true
    }
  ],
  "users": [
    {
      "username": "admin@test.com",
      "email": "admin@test.com",
      "firstName": "admin",
      "lastName": "admin",
      "enabled": true,
      "emailVerified": true,
      "realmRoles": ["admin"],
      "credentials": [
        { "type": "password", "value": "ChangeMe123!", "temporary": true }
      ],
      "requiredActions": ["UPDATE_PASSWORD"]
    },
    {
      "username": "salesman@test.com",
      "email": "salesman@test.com",
      "firstName": "sales",
      "lastName": "man",
      "enabled": true,
      "emailVerified": true,
      "realmRoles": ["sales-user"],
      "credentials": [
        { "type": "password", "value": "ChangeMe123!", "temporary": true }
      ],
      "requiredActions": ["UPDATE_PASSWORD"]
    },
    {
      "username": "opsman@test.com",
      "email": "opsman@test.com",
      "firstName": "ope",
      "lastName": "man",
      "enabled": true,
      "emailVerified": true,
      "realmRoles": ["support-operations-user"],
      "credentials": [
        { "type": "password", "value": "ChangeMe123!", "temporary": true }
      ],
      "requiredActions": ["UPDATE_PASSWORD"]
    },
    {
      "username": "compliance@test.com",
      "email": "compliance@test.com",
      "firstName": "compliance",
      "lastName": "ops",
      "enabled": true,
      "emailVerified": true,
      "realmRoles": ["ops-compliance"],
      "credentials": [
        { "type": "password", "value": "ChangeMe123!", "temporary": true }
      ],
      "requiredActions": ["UPDATE_PASSWORD"]
    },
    {
      "username": "crm@test.com",
      "email": "crm@test.com",
      "firstName": "customer",
      "lastName": "support",
      "enabled": true,
      "emailVerified": true,
      "realmRoles": ["customer-support"],
      "credentials": [
        { "type": "password", "value": "ChangeMe123!", "temporary": true }
      ],
      "requiredActions": ["UPDATE_PASSWORD"]
    }
  ]
}
```

Do not use this dev password strategy for production.

---

## 12. Docker Compose Keycloak Integration

If the repository already has Docker Compose, add Keycloak carefully without breaking the backend startup.

Example local services:

```yaml
keycloak:
  image: quay.io/keycloak/keycloak:26.6
  container_name: nova-keycloak
  command: start-dev --import-realm
  environment:
    KC_BOOTSTRAP_ADMIN_USERNAME: admin
    KC_BOOTSTRAP_ADMIN_PASSWORD: admin
  ports:
    - "8080:8080"
  volumes:
    - ./infra/keycloak/nova-realm.dev.json:/opt/keycloak/data/import/nova-realm.dev.json:ro
  healthcheck:
    test: ["CMD-SHELL", "exec 3<>/dev/tcp/127.0.0.1/8080; echo -e 'GET /realms/master HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: close\\r\\n\\r\\n' >&3; cat <&3 | grep -q '200 OK'"]
    interval: 10s
    timeout: 5s
    retries: 30
```

If the repository uses a different Keycloak version or production mode, adapt accordingly.

---

## 13. Admin User Management Requirements

The admin panel must not call Keycloak directly from the browser.

### 13.1 Required Backend-Driven Admin Flow

When an admin creates a new user from the frontend:

1. Admin fills:
   - email,
   - firstName,
   - lastName,
   - optional middleName,
   - optional description,
   - one or more roles.
2. Frontend calls backend:
   - `POST /admin/users`
3. Backend creates or updates:
   - application `users` table row,
   - `user_roles`,
   - Keycloak user in the `nova` realm,
   - Keycloak role mappings.
4. Backend returns the created application user plus sync status.

Expected request shape:

```ts
export interface CreateUserRequest {
  email: string;
  firstName: string;
  lastName: string;
  middleName?: string | null;
  description?: string | null;
  roles: string[];
  sendResetPasswordEmail?: boolean;
}
```

Expected response shape:

```ts
export interface AdminUserDto extends CurrentUser {
  keycloak: {
    exists: boolean;
    enabled: boolean;
    syncedRoles: string[];
    syncStatus: 'synced' | 'partial' | 'not_found' | 'error';
    lastSyncError?: string | null;
  };
}
```

### 13.2 Admin Screens

Implement `/app/admin/users` with:

- user table,
- search by email/name,
- filters by role,
- create user button,
- edit user profile,
- assign/unassign roles,
- deactivate/enable user if backend supports it,
- "sync to Keycloak" action if backend supports it,
- clear error messages if Keycloak provisioning fails.

Implement `/app/admin/roles` with:

- role list,
- permission matrix,
- role-permission read-only or editable depending on `write-permissions`,
- expected role_permissions count display for local seed verification.

### 13.3 Validation

Use Zod schemas:

```ts
const createUserSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  middleName: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  roles: z.array(z.enum(NOVA_ROLES)).min(1),
  sendResetPasswordEmail: z.boolean().optional(),
});
```

---

## 14. A2A Agent Chat Requirements

Implement `/app/chat` as a full chat experience.

### 14.1 Data Model

Backend has:

- `conversations`
- `messages`

Message roles:

```ts
export type MessageRole = 'system' | 'user' | 'assistant';
```

Message fields:

```ts
export interface MessageDto {
  id: string;
  conversationId: string;
  role: MessageRole;
  text: string;
  isMCPApps: boolean;
  MCPAppLink?: string | null;
  MCPActive?: boolean | null;
  createdDate: string;
  createdAt: string;
  updatedAt: string;
}
```

Conversation fields:

```ts
export interface ConversationDto {
  id: string;
  userId: string;
  createdDate: string;
  createdAt: string;
  updatedAt: string;
  messages?: MessageDto[];
}
```

### 14.2 Chat API

Support these API functions, adapting paths to the actual backend:

```ts
GET /conversations
GET /conversations/:id
POST /conversations
POST /conversations/:id/messages
POST /a2a/chat
```

Recommended agent request:

```ts
export interface AgentChatRequest {
  conversationId?: string;
  message: string;
  context?: {
    currentRoute?: string;
    selectedEntity?: {
      type: 'customer' | 'sale' | 'issue' | 'action' | 'sop';
      id: string;
    };
  };
}
```

Recommended agent response:

```ts
export interface AgentChatResponse {
  conversation: ConversationDto;
  assistantMessage: MessageDto;
  toolLinks?: Array<{
    label: string;
    href: string;
    type: 'customer' | 'sale' | 'issue' | 'action' | 'sop' | 'external';
  }>;
}
```

### 14.3 Chat UI

Chat page must include:

- conversation list,
- active chat thread,
- message composer,
- loading state while agent responds,
- retry on failed message,
- support for `MCPAppLink` / deep links such as:
  - `nova://issues/issue-philip-gamma-weak-suction`
  - `nova://sales/sale-philip-gamma-delta-2026-05-26`
  - `nova://roles/admin`
- a resolver that maps supported `nova://` links to frontend routes.
- safe rendering: never render assistant text as unsanitized HTML.

### 14.4 Deep Link Mapping

Implement:

```ts
export function resolveNovaLink(link: string): string | null {
  if (link.startsWith('nova://sales/')) return `/app/sales/${encodeURIComponent(link.split('/').pop()!)}`;
  if (link.startsWith('nova://issues/')) return `/app/issues/${encodeURIComponent(link.split('/').pop()!)}`;
  if (link.startsWith('nova://roles/')) return `/app/admin/roles?role=${encodeURIComponent(link.split('/').pop()!)}`;
  return null;
}
```

Adapt if backend returns actual UUIDs instead of seed keys.

---

## 15. Sales Workflow

Implement pages:

- `/app/sales`
- `/app/sales/new`
- optional `/app/sales/:id`

### 15.1 Sales List

Show:

- date,
- customer,
- products summary,
- total amount receipt,
- discount applied,
- payment received,
- date of payment,
- linked customer issues.

Filters:

- payment received / unpaid,
- date range,
- customer,
- product.

### 15.2 New Sale Form

The sales user can register a sale if they have `write-sales`.

Form fields:

- customer selector,
- sale date,
- discount applied percentage,
- payment received,
- payment date,
- sale items:
  - product selector,
  - quantity,
  - unit price display,
  - line total.

The frontend must calculate:

```text
subtotal = sum(product.price * quantity)
discount = subtotal * discountApplied / 100
total = subtotal - discount
```

Display a receipt summary. Send `totalAmountReceipt` as a string with two decimals.

Validation:

- customer required,
- at least one item,
- quantity > 0,
- discount >= 0 and <= 100,
- payment date required if payment received is true,
- payment date empty if payment received is false.

---

## 16. Customer Issue Workflow

Implement pages:

- `/app/issues`
- `/app/issues/new`
- `/app/issues/:id`

Customer issue statuses:

```ts
export type CustomerIssueStatus = 'in_assistance' | 'rejected' | 'completed';
```

### 16.1 Issue List

Show:

- customer,
- sale,
- issue description preview,
- date raised,
- date last update,
- status,
- number of actions,
- next pending action owner.

Filters:

- status,
- customer,
- assigned owner,
- date raised range.

### 16.2 Create Issue

Only users with `create-issues` can see and submit the create issue page.

Form fields:

- sale selector,
- issue description,
- date raised,
- status initial value default `in_assistance`.

Customer support and admin users can create issues. Support operations users must not see the create issue CTA.

### 16.3 Update Issue

Users with `write-issues` can update issue fields supported by backend:

- description,
- status,
- date last update.

Respect backend constraints.

---

## 17. Issue Action Workflow

Issue action statuses:

```ts
export type IssueActionStatus = 'pending' | 'in_progress' | 'completed' | 'rejected';
```

Implement:

- action timeline on issue detail page,
- `/app/actions` work queue,
- action status update form,
- assigned owner display,
- updated by display,
- AI-updated badge if `updatedAI` is true,
- dependency graph/list,
- comments panel.

### 17.1 Update Action

Users with `write-actions` can update:

- status,
- description if backend allows,
- assigned owner if backend allows,
- add comments.

When updating status:

- if action has dependencies that are not completed, warn before allowing transition to `in_progress` or `completed`;
- backend must enforce final validation.

### 17.2 Comments

Action comments include:

- user,
- comment text,
- business datetime,
- created/updated timestamps.

Use optimistic updates only after basic validation. Roll back on server error.

---

## 18. SOP Workflow

Implement pages:

- `/app/sops`
- `/app/sops/new`
- `/app/sops/:id`
- `/app/sops/:id/edit`

SOP tables:

- `sops`
- `sop_details`

### 18.1 SOP List

Show:

- name/title,
- active status,
- description,
- latest version,
- updated date.

### 18.2 SOP Detail

Show:

- SOP header,
- active status,
- latest version full text,
- version history,
- created by,
- date of creation.

### 18.3 Create/Edit SOP

Users with `write-sop` can create SOPs and new detail versions.

Important: editing an existing SOP should create a new `sop_details` version unless backend explicitly supports direct mutation. Do not overwrite old SOP detail history unless backend route is designed for it.

Validation:

- title/name required,
- description required,
- full text required,
- active boolean.

---

## 19. Customers and Products

### 19.1 Customers

Implement `/app/customers`.

Show:

- full name,
- email,
- age,
- active,
- sales count if backend provides it,
- issue count if backend provides it.

Users with `write-customers` can create or edit customers if backend supports customer mutations.

### 19.2 Products

Implement `/app/products`.

Show:

- product name,
- description,
- category,
- price,
- in catalog.

Product seed data includes:

- Alpha
- Beta
- Gamma
- Delta

Use product price as string from backend and format safely.

---

## 20. API Client Requirements

Create a typed API layer.

### 20.1 HTTP Client

Requirements:

- base URL from `VITE_API_BASE_URL`,
- bearer token injection,
- token refresh before requests,
- typed error object,
- JSON serialization,
- query params helper,
- no direct Keycloak admin calls.

Example error shape:

```ts
export interface ApiError {
  status: number;
  code?: string;
  message: string;
  details?: unknown;
}
```

### 20.2 TanStack Query

Use query keys such as:

```ts
export const queryKeys = {
  me: ['me'] as const,
  users: ['admin', 'users'] as const,
  roles: ['admin', 'roles'] as const,
  permissions: ['admin', 'permissions'] as const,
  customers: ['customers'] as const,
  products: ['products'] as const,
  sales: ['sales'] as const,
  issues: ['issues'] as const,
  actions: ['actions'] as const,
  sops: ['sops'] as const,
  conversations: ['conversations'] as const,
};
```

Invalidate affected queries after mutations.

---

## 21. TypeScript Domain Types

Create `src/api/types.ts` with at least:

```ts
export type UUID = string;

export type CustomerIssueStatus = 'in_assistance' | 'rejected' | 'completed';
export type IssueActionStatus = 'pending' | 'in_progress' | 'completed' | 'rejected';
export type MessageRole = 'system' | 'user' | 'assistant';

export interface UserDto {
  id: UUID;
  email: string;
  firstName: string;
  lastName: string;
  middleName?: string | null;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoleDto {
  name: string;
  description?: string | null;
}

export interface PermissionDto {
  name: string;
  description?: string | null;
}

export interface CustomerDto {
  id: UUID;
  email: string;
  fullName: string;
  firstName: string;
  lastName: string;
  age?: number | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProductDto {
  id: UUID;
  name: string;
  description?: string | null;
  category: string;
  price: string;
  inCatalog: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProductSoldDto {
  saleId: UUID;
  productId: UUID;
  quantity: number;
  product?: ProductDto;
}

export interface SaleDto {
  id: UUID;
  customerId: UUID;
  customer?: CustomerDto;
  discountApplied?: string | null;
  date: string;
  totalAmountReceipt: string;
  paymentReceived: boolean;
  dateOfPayment?: string | null;
  productsSold?: ProductSoldDto[];
  createdAt: string;
  updatedAt: string;
}

export interface CustomerIssueDto {
  id: UUID;
  salesId: UUID;
  sale?: SaleDto;
  description: string;
  dateRaised: string;
  dateLastUpdate: string;
  status: CustomerIssueStatus;
  issueActions?: IssueActionDto[];
  createdAt: string;
  updatedAt: string;
}

export interface IssueActionDto {
  id: UUID;
  issueId: UUID;
  title: string;
  description: string;
  status: IssueActionStatus;
  updatedById?: UUID | null;
  updatedAI?: boolean | null;
  createdDate: string;
  assignedOwnerId: UUID;
  assignedOwner?: UserDto;
  updatedBy?: UserDto | null;
  comments?: ActionCommentDto[];
  dependencies?: IssueActionDependencyDto[];
  createdAt: string;
  updatedAt: string;
}

export interface IssueActionDependencyDto {
  actionId: UUID;
  dependsOnActionId: UUID;
}

export interface ActionCommentDto {
  id: UUID;
  issueActionId: UUID;
  userId: UUID;
  user?: UserDto;
  comment: string;
  datetime: string;
  createdAt: string;
  updatedAt: string;
}

export interface SopDto {
  id: UUID;
  name: string;
  active: boolean;
  description: string;
  details?: SopDetailDto[];
  createdAt: string;
  updatedAt: string;
}

export interface SopDetailDto {
  sopId: UUID;
  version: number;
  fullText: string;
  dateOfCreation: string;
  createdById: UUID;
  createdBy?: UserDto;
  createdAt: string;
  updatedAt: string;
}
```

Adapt naming if backend uses `saleId` instead of `salesId`, but keep a normalization layer so UI code is consistent.

---

## 22. UX and UI Requirements

Implement a clean app shell:

- left sidebar,
- topbar with user profile and logout,
- responsive layout,
- mobile sidebar drawer,
- breadcrumbs or page title,
- loading skeletons,
- error states,
- empty states,
- accessible forms,
- keyboard-friendly buttons and modals.

### 22.1 Dashboard

Dashboard cards should show what matters to the current role:

- Admin:
  - users count,
  - roles count,
  - permissions count,
  - recent issues,
  - recent conversations.
- Sales:
  - recent sales,
  - unpaid sales,
  - customers,
  - issue read-only summary.
- Customer support:
  - open issues,
  - pending actions,
  - completed/rejected issues.
- Operations:
  - assigned actions,
  - in-progress actions,
  - actions blocked by dependencies.
- Compliance:
  - SOP count,
  - active SOPs,
  - latest SOP versions.

### 22.2 Status Badges

Use consistent status badges:

- Issue:
  - `in_assistance`
  - `rejected`
  - `completed`
- Action:
  - `pending`
  - `in_progress`
  - `completed`
  - `rejected`
- Payment:
  - paid
  - unpaid
- SOP:
  - active
  - inactive

---

## 23. Security Requirements

1. Do not store access tokens in localStorage unless the current project already made that tradeoff explicitly.
2. Prefer in-memory Keycloak token management through the adapter.
3. Never expose Keycloak admin credentials to the browser.
4. Never let the browser call Keycloak Admin REST APIs.
5. Do not display dev temporary passwords in the UI.
6. Sanitize or plain-text render agent responses.
7. Enforce authorization on backend. Frontend permission checks are only UX.
8. Avoid overly broad Keycloak redirect URIs in production.
9. Log user-facing errors without leaking tokens or secrets.
10. Use HTTPS in production.

---

## 24. Testing Requirements

Add unit/integration tests for:

- permission helper functions,
- route guards,
- sidebar visibility per role,
- admin create user form validation,
- sales total calculation,
- issue creation permissions,
- support operations cannot see create issue action,
- compliance can create/edit SOP,
- chat message send flow,
- `nova://` deep link resolver,
- API client attaches bearer token.

Use MSW to mock backend responses.

### 24.1 Role Visibility Tests

Create fixtures for the five seeded users and assert:

- `admin@test.com` sees all admin and domain screens.
- `salesman@test.com` sees sales create screen but not admin.
- `opsman@test.com` sees action update screens but not create issue.
- `compliance@test.com` sees SOP edit/create screens only.
- `crm@test.com` sees create issue and action update screens.

---

## 25. Acceptance Criteria

The frontend is complete when:

1. `npm run dev` starts the frontend.
2. The app redirects unauthenticated users to Keycloak.
3. Keycloak login returns to the app successfully.
4. The frontend fetches current user profile and permissions from the backend.
5. Sidebar and routes are filtered by effective permissions.
6. Admin can create a user through the backend admin endpoint.
7. Admin user creation also provisions/synchronizes the user in Keycloak via backend, not browser.
8. Admin can assign roles to users.
9. Compliance can create a new SOP and create a new version for an existing SOP.
10. Sales can register a sale and the UI calculates receipt totals.
11. Customer support can create and update customer issues.
12. Support operations can update issue actions but cannot create new issues.
13. Users can open chat, create/select conversations, send messages, and view assistant responses.
14. Chat supports `MCPAppLink` / `nova://` deep links.
15. Unauthorized routes show a clear forbidden page or redirect safely.
16. Loading, empty, and error states are implemented.
17. Tests cover the main authorization and workflow rules.
18. No frontend code contains database passwords, Keycloak admin passwords, or production secrets.
19. No frontend code attempts to write passwords to the PostgreSQL application user table.
20. The project README documents local Keycloak setup and how to use the seeded test users.

---

## 26. Implementation Order for Cursor

Follow this order:

1. Inspect repository structure and package manager.
2. Add frontend dependencies only if missing.
3. Create environment handling and `.env.example`.
4. Implement Keycloak adapter setup.
5. Implement API client with token injection.
6. Implement auth provider and `/auth/me` query.
7. Implement permissions constants and authorization helpers.
8. Implement app router and protected routes.
9. Implement app shell, sidebar, topbar, forbidden page, loading states.
10. Implement dashboard.
11. Implement chat feature and conversation/message APIs.
12. Implement admin users page.
13. Implement admin roles/permissions page.
14. Implement customers and products pages.
15. Implement sales list and new sale workflow.
16. Implement issues list, create issue, and issue detail pages.
17. Implement action work queue, status editor, comments, dependencies.
18. Implement SOP list, details, editor, version history.
19. Add Keycloak realm import file.
20. Update Docker Compose for local Keycloak if applicable.
21. Add tests.
22. Update README with setup and verification instructions.
23. Run typecheck, lint, tests, and build.
24. Fix all failures.

---

## 27. README Setup Section to Add

Add a README section similar to:

```md
## Nova Frontend Local Development

### Start infrastructure

```bash
docker compose up postgres keycloak
```

### Start backend

```bash
npm run db:init
npm run start:dev
```

### Start frontend

```bash
cp .env.example .env
npm install
npm run dev
```

Frontend default URL:

```text
http://localhost:5173
```

Keycloak default local URL:

```text
http://localhost:8080
```

Realm:

```text
nova
```

Client:

```text
nova-frontend
```

Seeded local users:

| Email | Role |
|---|---|
| `admin@test.com` | `admin` |
| `salesman@test.com` | `sales-user` |
| `opsman@test.com` | `support-operations-user` |
| `compliance@test.com` | `ops-compliance` |
| `crm@test.com` | `customer-support` |

Local development realm imports may assign a temporary password with `UPDATE_PASSWORD` required. Do not store these passwords in the application database.
```

---

## 28. Backend Endpoint Checklist

During implementation, discover actual backend routes. If they do not exist, create the frontend API layer with clear TODOs and mock handlers, then document the required backend endpoints:

```text
GET    /api/auth/me

GET    /api/admin/users
POST   /api/admin/users
PATCH  /api/admin/users/:id
PUT    /api/admin/users/:id/roles
POST   /api/admin/users/:id/sync-keycloak
GET    /api/admin/roles
GET    /api/admin/permissions
PUT    /api/admin/roles/:roleName/permissions

GET    /api/customers
POST   /api/customers
PATCH  /api/customers/:id

GET    /api/products

GET    /api/sales
POST   /api/sales
GET    /api/sales/:id

GET    /api/issues
POST   /api/issues
GET    /api/issues/:id
PATCH  /api/issues/:id

GET    /api/actions
PATCH  /api/actions/:id
POST   /api/actions/:id/comments

GET    /api/sops
POST   /api/sops
GET    /api/sops/:id
POST   /api/sops/:id/versions
PATCH  /api/sops/:id

GET    /api/conversations
POST   /api/conversations
GET    /api/conversations/:id
POST   /api/conversations/:id/messages
POST   /api/a2a/chat
```

Do not block frontend development if exact backend routes differ. Add a small adapter layer so path changes are centralized.

---

## 29. Final Verification Commands

Run the relevant commands for the repo:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

If these scripts do not exist, add reasonable scripts or document the existing equivalents.

Also manually verify:

1. Login as each seeded user.
2. Confirm visible navigation matches the role.
3. Try accessing forbidden routes by URL.
4. Create a sale as sales user.
5. Create an issue as customer support user.
6. Confirm operations user cannot create an issue.
7. Update an action as operations user.
8. Create/update SOP as compliance user.
9. Create a new user as admin and confirm backend reports Keycloak sync success.
10. Send a chat message and open any returned `nova://` deep link.

---

## 30. Non-Negotiables

- Do not put Keycloak admin credentials in frontend code.
- Do not call Keycloak Admin REST APIs from the browser.
- Do not add password fields to frontend DTOs for application DB users.
- Do not assume UI checks are sufficient authorization.
- Do not use floating point for money display/calculation without final fixed two-decimal normalization.
- Do not expose routes/actions to users lacking permissions.
- Do not break the existing backend database naming and seed assumptions.
