# Nova — Next-Generation Operations and Virtual Assistance

## About Nova

**Nova (Next-Generation Operations and Virtual Assistance)** is a secure, agentic
operations platform. It gives a team a single chat-driven console where a user can
ask natural-language questions about their business data — customers, products,
sales, issues, action workflows, and SOPs — and have an autonomous AI agent answer
them, ground its answers in the real database, and (when explicitly entitled and
approved) perform actions on their behalf.

Architecturally, Nova is split into **two planes that never blur into each other**:

- A **control plane** (Node.js / TypeScript) — the only thing a browser ever talks
  to. It owns identity, RBAC, business data, conversations, and the durable record
  of every agent run, and it decides *what a user is allowed to do*.
- An **execution plane** (Python — Celery + LangGraph + A2A agents) — a pure
  delegator/worker that runs the agentic work asynchronously. It never sees the
  user's token, never touches the business database directly, and re-checks every
  authorization decision against an immutable **entitlement snapshot** before
  acting.

The guiding rules throughout are **default deny, least privilege, centralized
authentication and authorization, and ID-only messaging** (no prompts, tokens, or
PII are ever placed on a queue or in an inter-agent message). Identity is handled by
**Keycloak**, observability by **Langfuse**, and the whole system comes up — fully
seeded — with a single `docker compose up`.

---

## Setup

### Versions used to build and test

The solution was built and validated against the following toolchain:

| Component | Version |
| --- | --- |
| Operating system | Windows 11 (build 10.0.26200) with Docker Desktop v4.75.0 |
| Docker Engine | 29.5.2 |
| Docker Compose | v5.1.3 |
| Node.js | 22 (`>=22`, `node:22-alpine` in containers) |
| React | 19 (with Vite 8, TypeScript) |
| Python | 3.12 (`python:3.12-slim` for the agents/orchestrator) |
| PostgreSQL | 16 |
| Keycloak | 26.6 |
| Redis | 7 |

> Everything runs in containers, so the host only needs **Docker** (Engine +
> Compose v2). The versions above are what the stack was tested with; recent Docker
> Desktop releases with Compose V2 will work equally well. Might need some adjustments docker compose and docker files for MacOS systems.

### Step-by-step

The entire system — databases, Keycloak realm, users, business seed data, Langfuse
project, and all services — is provisioned automatically. You only need to supply
your LLM credentials.

#### 1. Create your `.env` file

From the repository root, copy the example file to `.env`:

```bash
cp .env.example .env
```

#### 2. Add your OpenAI key and host

Open `.env` and set the LLM credentials. These are the **only** values you must
change to get a working system; everything else is pre-wired for local Docker:

| Variable | What to set it to |
| --- | --- |
| `OPENAI_API_KEY` | Your OpenAI (or OpenAI-compatible) API key. Replace the placeholder `change-me`. |
| `OPENAI_BASE_URL` | Your provider/host base URL. Replace `your-url`. Leave empty (`OPENAI_BASE_URL=`) to use the default OpenAI endpoint. |
| `LLM_MODEL` | The model to reason with (e.g. `gpt-4o-mini`, or an OpenAI-compatible model such as `kimi-2.6`). Optional. |

```dotenv
# ---- LLM (OpenAI) powering autonomous reasoning ----
OPENAI_BASE_URL=https://your-host/v1
OPENAI_API_KEY=sk-your-real-key
LLM_MODEL=gpt-5.4
```

> All other secrets and ports in `.env.example` are local development defaults and
> work out of the box. They must be rotated for any non-local environment.

#### 3. Bring the whole system up (auto-seeded)

From the repository root:

```bash
docker compose up --build
```

This single command:

- starts both PostgreSQL databases (business `nova` + isolated `nova_agents`), the
  three Redis instances, and Keycloak;
- runs database migrations and **seeds** all business data automatically
  (one-shot `db-init` / `db-init-agents` services);
- imports the **`nova` Keycloak realm** with all roles, clients, and the five
  seeded users;
- brings up Langfuse v3 and headlessly seeds its org/project and keys;
- starts the API, the DB MCP server, the orchestrator gateway, the Celery worker,
  the webhook dispatcher, and the SQL-analyst A2A agent.

Once it is healthy, open the app and sign in:

| Surface | URL |
| --- | --- |
| Nova web app | http://localhost:5173 |
| API | http://localhost:3000/api/v1 |
| Keycloak admin console | http://localhost:8080 |
| Langfuse (observability) | http://localhost:3100 |

> To start fresh at any point (clean databases, realm, and all volumes):
> `docker compose down -v` then `docker compose up --build`.

At the end of te execution you MUST see 20 components running in Docker Desktop.
---

## Users, passwords, roles & permissions

### Immediately available users

Five interactive users are seeded into both the Keycloak realm and the business
database. **All five share the same temporary password and must change it on first
login.**

| Username / email | Name | Role | Temporary password | Change on first login? |
| --- | --- | --- | --- | --- |
| `admin@test.com` | admin admin | `admin` | `ChangeMe123!` | Yes |
| `salesman@test.com` | sales man | `sales-user` | `ChangeMe123!` | Yes |
| `opsman@test.com` | ope man | `support-operations-user` | `ChangeMe123!` | Yes |
| `compliance@test.com` | compliance ops | `ops-compliance` | `ChangeMe123!` | Yes |
| `crm@test.com` | customer support | `customer-support` | `ChangeMe123!` | Yes |

Each user logs in once at http://localhost:5173 with `ChangeMe123!`, and Keycloak
**immediately forces a password change** before any token is issued. After that,
`ChangeMe123!` no longer works for that user.

> **Note:** running the agentic-quality harness (`test-quality/test.py`)
> permanently rewrites these seeded passwords (to `TestRunner123!`, non-temporary)
> and clears the first-login gate. To restore the documented state, rebuild from a
> clean slate (`docker compose down -v && docker compose up --build`). See
> [`deliverables-documents/KEYCLOAK.md`](deliverables-documents/KEYCLOAK.md) for the
> full detail.

### Roles → permissions

The role-to-permission grants below are the single source of truth shared by the
runtime authorization pipeline and the database seed.

| Permission | `admin` | `sales-user` | `support-operations-user` | `customer-support` | `ops-compliance` |
| --- | :---: | :---: | :---: | :---: | :---: |
| `read-customers` | ✅ | ✅ | ✅ | ✅ | — |
| `write-customers` | ✅ | ✅ | ✅ | — | — |
| `create-issues` | ✅ | — | — | ✅ | — |
| `read-issues` | ✅ | ✅ | ✅ | ✅ | — |
| `write-issues` | ✅ | — | ✅ | ✅ | — |
| `read-sales` | ✅ | ✅ | ✅ | ✅ | — |
| `write-sales` | ✅ | ✅ | — | — | — |
| `read-actions` | ✅ | ✅ | ✅ | ✅ | — |
| `write-actions` | ✅ | — | ✅ | ✅ | — |
| `read-sop` | ✅ | ✅ | ✅ | — | ✅ |
| `write-sop` | ✅ | — | — | — | ✅ |
| `read-permissions` | ✅ | — | — | — | — |
| `write-permissions` | ✅ | — | — | — | — |
| `read-users` | ✅ | — | — | — | — |
| `write-users` | ✅ | — | — | — | — |
| `create-agent-run` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `read-agent-run` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `cancel-agent-run` | ✅ | ✅ | ✅ | ✅ | ✅ |

### What each user can do

- **`admin@test.com` (admin)** — full system access. Can read and write every
  domain (customers, issues, sales, actions, SOPs), plus manage users and
  permissions. The only role that can administer users/permissions.
- **`salesman@test.com` (sales-user)** — the sales team. Manages customers and
  sales (read/write), reads issues, actions, and SOPs. Cannot write issues, actions,
  or SOPs.
- **`opsman@test.com` (support-operations-user)** — operations & maintenance. Drives
  issue and action workflows (read/write issues and actions), manages customers,
  reads sales and SOPs. Cannot write sales or SOPs.
- **`compliance@test.com` (ops-compliance)** — the compliance team. Authors and
  maintains SOPs (read/write SOPs). Deliberately has **no** access to customers,
  sales, issues, or actions — used to prove least-privilege denials.
- **`crm@test.com` (customer-support)** — customer support. Logs and works issues
  (create/read/write issues, read/write actions), reads customers and sales. Cannot
  write customers, sales, or SOPs.

Every role can start, read, and cancel its own agent runs; what an agent may then do
on the user's behalf is bounded by that user's permissions above.

### Keycloak master-realm admin credentials

The Keycloak admin console at http://localhost:8080 uses the bootstrap **master
realm** superuser:

| Username | Password |
| --- | --- |
| `admin` | `admin` |

> This account administers Keycloak itself; it is **not** a Nova application user
> and lives in the `master` realm, not the `nova` realm. **You do not need it for
> normal use** — the `nova` realm, its clients, roles, and users are all configured
> automatically on startup. It is documented for completeness only, and must be
> changed for any shared or non-local environment.

---

## Solution Architecture

A detailed architectural reference — every component, how they fit together, the
trust boundaries, and exactly how a user question travels from the browser through
the orchestrator to an A2A agent and its MCP tools (with both system-design and
agentic-flow diagrams) — is in:

- [**Solution Design** → `deliverables-documents/SOLUTION_DESIGN.md`](deliverables-documents/SOLUTION_DESIGN.md)

Identity and Keycloak integration specifics (realm, clients, seeding, first-login
behaviour, production hardening) are in:

- [**Keycloak Integration** → `deliverables-documents/KEYCLOAK.md`](deliverables-documents/KEYCLOAK.md)

## Use of AI

How AI (Cursor + the coding assistant) was used to build this platform — the
spec-driven approach, the guardrails set up before writing code, and the close
human review of every output:

- [**Use of AI** → `deliverables-documents/USE_OF_AI.md`](deliverables-documents/USE_OF_AI.md)

## Evaluation Results

The agentic-quality evaluation — what was tested, the LLM-as-Judge approach,
deterministic security/write checks, and the per-scenario commentary:

- [**Evaluation Results (commentary)** → `deliverables-documents/EVALUATION_RESULTS.md`](deliverables-documents/EVALUATION_RESULTS.md)
- [**Full evaluation report (spreadsheet)** → `deliverables-documents/nova_agentic_quality_report_gpt.xlsx`](deliverables-documents/nova_agentic_quality_report_gpt.xlsx)
