import { http, HttpResponse, type DefaultBodyType, type PathParams } from 'msw';
import { env } from '@/lib/env';
import { NOVA_ROLES, ROLE_PERMISSIONS, type NovaRole } from '@/auth/permissions';
import type {
  ActionCommentDto,
  AdminUserDto,
  AgentRunDto,
  AgentRunEventDto,
  ConversationDto,
  IssueActionStatus,
  MessageDto,
  PaginatedResult,
  SaleDto,
  SopDto,
} from '@/api/types';
import {
  actionsStore,
  ALL_PERMISSIONS,
  conversationsStore,
  customersStore,
  findUserByEmail,
  issuesStore,
  productsStore,
  salesStore,
  sopsStore,
  usersStore,
} from './fixtures';

const API = env.apiBaseUrl.replace(/\/$/, '');
const ts = () => new Date().toISOString();

/** In-memory agent runs created via the chat entrypoint (mock async pipeline). */
const agentRunsStore = new Map<string, { run: AgentRunDto; events: AgentRunEventDto[] }>();

/** Resolve the seeded user email encoded in the mock bearer token. */
function emailFromRequest(request: Request): string | null {
  const header = request.headers.get('Authorization');
  if (!header?.startsWith('Bearer mock.')) {
    return null;
  }
  return header.slice('Bearer mock.'.length);
}

function unauthorized() {
  return HttpResponse.json(
    { code: 'unauthenticated', title: 'A bearer token is required.', status: 401 },
    { status: 401 },
  );
}

function notFound(detail = 'Resource not found.') {
  return HttpResponse.json({ code: 'not_found', title: detail, status: 404 }, { status: 404 });
}

function paginate<T>(items: readonly T[], url: URL): PaginatedResult<T> {
  const page = Number(url.searchParams.get('page') ?? '1') || 1;
  const pageSize = Number(url.searchParams.get('pageSize') ?? '20') || 20;
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page,
    pageSize,
    total: items.length,
    totalPages: Math.max(1, Math.ceil(items.length / pageSize)),
  };
}

function permissionsForRoles(roles: readonly NovaRole[]): string[] {
  const set = new Set<string>();
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role]) {
      set.add(permission);
    }
  }
  return [...set];
}

// Mutable role -> permission grants for the admin matrix.
const roleGrants: Record<string, string[]> = Object.fromEntries(
  NOVA_ROLES.map((role) => [role, [...ROLE_PERMISSIONS[role]]]),
);

let idCounter = 1000;
const nextId = (prefix: string) => `${prefix}-${++idCounter}`;

export const handlers = [
  http.get(`${API}/auth/me`, ({ request }) => {
    const email = emailFromRequest(request);
    if (!email) return unauthorized();
    const user = findUserByEmail(email);
    if (!user) return unauthorized();
    return HttpResponse.json({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      middleName: user.middleName ?? null,
      description: user.description ?? null,
      roles: user.roles,
      permissions: user.permissions,
    });
  }),

  // ---- Admin: users ----
  http.get(`${API}/admin/users`, ({ request }) => {
    const url = new URL(request.url);
    const search = url.searchParams.get('search')?.toLowerCase();
    const role = url.searchParams.get('role');
    let items = [...usersStore];
    if (search) {
      items = items.filter(
        (user) =>
          user.email.toLowerCase().includes(search) ||
          `${user.firstName} ${user.lastName}`.toLowerCase().includes(search),
      );
    }
    if (role) {
      items = items.filter((user) => user.roles.includes(role));
    }
    return HttpResponse.json(paginate(items, url));
  }),

  http.post(`${API}/admin/users`, async ({ request }) => {
    const body = (await request.json()) as {
      email: string;
      firstName: string;
      lastName: string;
      middleName?: string | null;
      description?: string | null;
      roles: NovaRole[];
    };
    const roles = body.roles.filter((role): role is NovaRole => NOVA_ROLES.includes(role));
    const user: AdminUserDto = {
      id: nextId('user'),
      email: body.email,
      firstName: body.firstName,
      lastName: body.lastName,
      middleName: body.middleName ?? null,
      description: body.description ?? null,
      roles,
      permissions: permissionsForRoles(roles),
      active: true,
      createdAt: ts(),
      updatedAt: ts(),
      keycloak: { exists: true, enabled: true, syncedRoles: roles, syncStatus: 'synced', lastSyncError: null },
    };
    usersStore.unshift(user);
    return HttpResponse.json(user, { status: 201 });
  }),

  http.patch(`${API}/admin/users/:id`, async ({ params, request }) => {
    const user = usersStore.find((u) => u.id === params.id);
    if (!user) return notFound('User not found.');
    const body = (await request.json()) as Partial<AdminUserDto>;
    Object.assign(user, { ...body, updatedAt: ts() });
    return HttpResponse.json(user);
  }),

  http.put(`${API}/admin/users/:id/roles`, async ({ params, request }) => {
    const user = usersStore.find((u) => u.id === params.id);
    if (!user) return notFound('User not found.');
    const { roles } = (await request.json()) as { roles: NovaRole[] };
    const valid = roles.filter((role): role is NovaRole => NOVA_ROLES.includes(role));
    user.roles = valid;
    user.permissions = permissionsForRoles(valid);
    user.keycloak = { ...user.keycloak, syncedRoles: valid, syncStatus: 'synced' };
    user.updatedAt = ts();
    return HttpResponse.json(user);
  }),

  http.post(`${API}/admin/users/:id/sync-keycloak`, ({ params }) => {
    const user = usersStore.find((u) => u.id === params.id);
    if (!user) return notFound('User not found.');
    user.keycloak = { exists: true, enabled: true, syncedRoles: user.roles, syncStatus: 'synced', lastSyncError: null };
    return HttpResponse.json(user);
  }),

  // ---- Admin: roles & permissions ----
  http.get(`${API}/admin/roles`, () =>
    HttpResponse.json(NOVA_ROLES.map((name) => ({ name }))),
  ),
  http.get(`${API}/admin/permissions`, () =>
    HttpResponse.json(ALL_PERMISSIONS.map((name) => ({ name }))),
  ),
  http.get(`${API}/admin/role-permissions`, () =>
    HttpResponse.json({
      roles: NOVA_ROLES.map((name) => ({ name })),
      permissions: ALL_PERMISSIONS.map((name) => ({ name })),
      grants: roleGrants,
      totalGrants: Object.values(roleGrants).reduce((sum, list) => sum + list.length, 0),
    }),
  ),
  http.put(`${API}/admin/roles/:roleName/permissions`, async ({ params, request }) => {
    const role = String(params.roleName);
    if (!roleGrants[role]) return notFound('Role not found.');
    const { permissions } = (await request.json()) as { permissions: string[] };
    roleGrants[role] = permissions;
    return HttpResponse.json({
      roles: NOVA_ROLES.map((name) => ({ name })),
      permissions: ALL_PERMISSIONS.map((name) => ({ name })),
      grants: roleGrants,
      totalGrants: Object.values(roleGrants).reduce((sum, list) => sum + list.length, 0),
    });
  }),

  // ---- Customers ----
  http.get(`${API}/customers`, ({ request }) => {
    const url = new URL(request.url);
    const search = url.searchParams.get('search')?.toLowerCase();
    let items = [...customersStore];
    if (search) {
      items = items.filter(
        (c) => c.fullName.toLowerCase().includes(search) || c.email.toLowerCase().includes(search),
      );
    }
    return HttpResponse.json(paginate(items, url));
  }),
  http.get(`${API}/customers/:id`, ({ params }) => {
    const customer = customersStore.find((c) => c.id === params.id);
    return customer ? HttpResponse.json(customer) : notFound('Customer not found.');
  }),

  // ---- Products ----
  http.get(`${API}/products`, ({ request }) => {
    const url = new URL(request.url);
    const search = url.searchParams.get('search')?.toLowerCase();
    let items = [...productsStore];
    if (search) {
      items = items.filter((p) => p.name.toLowerCase().includes(search));
    }
    return HttpResponse.json(paginate(items, url));
  }),

  // ---- Sales ----
  http.get(`${API}/sales`, ({ request }) => {
    const url = new URL(request.url);
    const paid = url.searchParams.get('paymentReceived');
    let items = [...salesStore];
    if (paid !== null) {
      items = items.filter((s) => s.paymentReceived === (paid === 'true'));
    }
    return HttpResponse.json(paginate(items, url));
  }),
  http.get(`${API}/sales/:id`, ({ params }) => {
    const sale = salesStore.find((s) => s.id === params.id);
    return sale ? HttpResponse.json(sale) : notFound('Sale not found.');
  }),
  http.post(`${API}/sales`, async ({ request }) => {
    const body = (await request.json()) as {
      customerId: string;
      date: string;
      discountApplied: string;
      paymentReceived: boolean;
      dateOfPayment?: string | null;
      items: { productId: string; quantity: number }[];
      totalAmountReceipt: string;
    };
    const id = nextId('sale');
    const sale: SaleDto = {
      id,
      customerId: body.customerId,
      customer: customersStore.find((c) => c.id === body.customerId),
      discountApplied: body.discountApplied,
      date: body.date,
      totalAmountReceipt: body.totalAmountReceipt,
      paymentReceived: body.paymentReceived,
      dateOfPayment: body.dateOfPayment ?? null,
      productsSold: body.items.map((item) => ({
        saleId: id,
        productId: item.productId,
        quantity: item.quantity,
        product: productsStore.find((p) => p.id === item.productId),
      })),
      issuesCount: 0,
      createdAt: ts(),
      updatedAt: ts(),
    };
    salesStore.unshift(sale);
    return HttpResponse.json(sale, { status: 201 });
  }),

  // ---- Issues ----
  http.get(`${API}/issues`, ({ request }) => {
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    let items = [...issuesStore];
    if (status) {
      items = items.filter((issue) => issue.status === status);
    }
    return HttpResponse.json(paginate(items, url));
  }),
  http.get(`${API}/issues/:id`, ({ params }) => {
    const issue = issuesStore.find((i) => i.id === params.id);
    return issue ? HttpResponse.json(issue) : notFound('Issue not found.');
  }),
  http.post(`${API}/issues`, async ({ request }) => {
    const body = (await request.json()) as {
      salesId: string;
      description: string;
      dateRaised: string;
      status: 'in_assistance' | 'rejected' | 'completed';
    };
    const id = nextId('issue');
    const sale = salesStore.find((s) => s.id === body.salesId);
    const issue = {
      id,
      salesId: body.salesId,
      sale,
      description: body.description,
      dateRaised: body.dateRaised,
      dateLastUpdate: body.dateRaised,
      status: body.status,
      issueActions: [],
      createdAt: ts(),
      updatedAt: ts(),
    };
    issuesStore.unshift(issue);
    return HttpResponse.json(issue, { status: 201 });
  }),
  http.patch(`${API}/issues/:id`, async ({ params, request }) => {
    const issue = issuesStore.find((i) => i.id === params.id);
    if (!issue) return notFound('Issue not found.');
    const body = (await request.json()) as Partial<typeof issue>;
    Object.assign(issue, body, { updatedAt: ts() });
    return HttpResponse.json(issue);
  }),

  // ---- Actions ----
  http.get(`${API}/actions`, ({ request }) => {
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    let items = [...actionsStore];
    if (status) {
      items = items.filter((action) => action.status === status);
    }
    return HttpResponse.json(paginate(items, url));
  }),
  http.patch(`${API}/actions/:id`, async ({ params, request }) => {
    const action = actionsStore.find((a) => a.id === params.id);
    if (!action) return notFound('Action not found.');
    const body = (await request.json()) as { status?: IssueActionStatus; description?: string };
    if (body.status) action.status = body.status;
    if (body.description) action.description = body.description;
    action.updatedAt = ts();
    return HttpResponse.json(action);
  }),
  http.post(`${API}/actions/:id/comments`, async ({ params, request }) => {
    const action = actionsStore.find((a) => a.id === params.id);
    if (!action) return notFound('Action not found.');
    const body = (await request.json()) as { comment: string; datetime: string };
    const comment: ActionCommentDto = {
      id: nextId('comment'),
      issueActionId: action.id,
      userId: 'user-crm',
      user: usersStore.find((u) => u.id === 'user-crm'),
      comment: body.comment,
      datetime: body.datetime,
      createdAt: ts(),
      updatedAt: ts(),
    };
    action.comments = [...(action.comments ?? []), comment];
    return HttpResponse.json(comment, { status: 201 });
  }),

  // ---- SOPs ----
  http.get(`${API}/sops`, ({ request }) => {
    const url = new URL(request.url);
    const search = url.searchParams.get('search')?.toLowerCase();
    let items = [...sopsStore];
    if (search) {
      items = items.filter((sop) => sop.name.toLowerCase().includes(search));
    }
    return HttpResponse.json(paginate(items, url));
  }),
  http.get(`${API}/sops/:id`, ({ params }) => {
    const sop = sopsStore.find((s) => s.id === params.id);
    return sop ? HttpResponse.json(sop) : notFound('SOP not found.');
  }),
  http.post(`${API}/sops`, async ({ request }) => {
    const body = (await request.json()) as {
      name: string;
      description: string;
      active: boolean;
      fullText: string;
    };
    const id = nextId('sop');
    const sop: SopDto = {
      id,
      name: body.name,
      description: body.description,
      active: body.active,
      latestVersion: 1,
      details: [
        {
          sopId: id,
          version: 1,
          fullText: body.fullText,
          dateOfCreation: ts(),
          createdById: 'user-compliance',
          createdBy: usersStore.find((u) => u.id === 'user-compliance'),
          createdAt: ts(),
          updatedAt: ts(),
        },
      ],
      createdAt: ts(),
      updatedAt: ts(),
    };
    sopsStore.unshift(sop);
    return HttpResponse.json(sop, { status: 201 });
  }),
  http.post(`${API}/sops/:id/versions`, async ({ params, request }) => {
    const sop = sopsStore.find((s) => s.id === params.id);
    if (!sop) return notFound('SOP not found.');
    const body = (await request.json()) as { fullText: string };
    const version = (sop.latestVersion ?? sop.details?.length ?? 0) + 1;
    const detail = {
      sopId: sop.id,
      version,
      fullText: body.fullText,
      dateOfCreation: ts(),
      createdById: 'user-compliance',
      createdBy: usersStore.find((u) => u.id === 'user-compliance'),
      createdAt: ts(),
      updatedAt: ts(),
    };
    sop.details = [...(sop.details ?? []), detail];
    sop.latestVersion = version;
    sop.updatedAt = ts();
    return HttpResponse.json(detail, { status: 201 });
  }),
  http.patch(`${API}/sops/:id`, async ({ params, request }) => {
    const sop = sopsStore.find((s) => s.id === params.id);
    if (!sop) return notFound('SOP not found.');
    const body = (await request.json()) as Partial<SopDto>;
    Object.assign(sop, body, { updatedAt: ts() });
    return HttpResponse.json(sop);
  }),

  // ---- Conversations & agent chat ----
  http.get(`${API}/conversations`, () => HttpResponse.json(conversationsStore)),
  http.get(`${API}/conversations/:id`, ({ params }) => {
    const conversation = conversationsStore.find((c) => c.id === params.id);
    return conversation ? HttpResponse.json(conversation) : notFound('Conversation not found.');
  }),
  http.post(`${API}/conversations`, ({ request }) => {
    const email = emailFromRequest(request);
    const user = email ? findUserByEmail(email) : undefined;
    const conversation: ConversationDto = {
      id: nextId('conversation'),
      userId: user?.id ?? 'user-admin',
      title: 'New conversation',
      createdDate: ts(),
      createdAt: ts(),
      updatedAt: ts(),
      messages: [],
    };
    conversationsStore.unshift(conversation);
    return HttpResponse.json(conversation, { status: 201 });
  }),

  // Chat entrypoint: creates an agent run (mirrors `POST /a2a/chat`). The mock
  // persists the user + assistant messages immediately and records a short event
  // script the SSE stream below replays, so the async run UX works offline.
  http.post<PathParams, DefaultBodyType>(`${API}/a2a/chat`, async ({ request }) => {
    if (!emailFromRequest(request)) {
      return unauthorized();
    }
    const email = emailFromRequest(request);
    const user = email ? findUserByEmail(email) : undefined;
    const body = (await request.json()) as { conversationId?: string; message: string };

    let conversation = body.conversationId
      ? conversationsStore.find((c) => c.id === body.conversationId)
      : undefined;
    if (!conversation) {
      conversation = {
        id: nextId('conversation'),
        userId: user?.id ?? 'user-admin',
        title: body.message.slice(0, 40),
        createdDate: ts(),
        createdAt: ts(),
        updatedAt: ts(),
        messages: [],
      };
      conversationsStore.unshift(conversation);
    }

    const userMessage: MessageDto = {
      id: nextId('msg'),
      conversationId: conversation.id,
      role: 'user',
      text: body.message,
      isMCPApps: false,
      MCPAppLink: null,
      MCPActive: null,
      createdDate: ts(),
      createdAt: ts(),
      updatedAt: ts(),
    };

    const reply = buildAssistantReply(body.message, conversation.id);
    conversation.messages = [...(conversation.messages ?? []), userMessage, reply.message];
    conversation.updatedAt = ts();

    const runId = nextId('run');
    const run: AgentRunDto = {
      runId,
      status: 'running',
      conversationId: conversation.id,
      cancelRequested: false,
      finalResponse: reply.message.text,
      eventsUrl: `${API}/agent-runs/${runId}/events`,
      createdAt: ts(),
      updatedAt: ts(),
      expiresAt: null,
    };
    const events: AgentRunEventDto[] = [
      { id: nextId('evt'), sequence: 1, type: 'run.started', payload: {}, createdAt: ts() },
      {
        id: nextId('evt'),
        sequence: 2,
        type: 'tool.call.completed',
        payload: { summary: reply.message.text },
        createdAt: ts(),
      },
      { id: nextId('evt'), sequence: 3, type: 'run.completed', payload: {}, createdAt: ts() },
    ];
    agentRunsStore.set(runId, { run, events });

    return HttpResponse.json(run, { status: 202 });
  }),

  http.get(`${API}/agent-runs/:runId`, ({ params, request }) => {
    if (!emailFromRequest(request)) {
      return unauthorized();
    }
    const entry = agentRunsStore.get(String(params.runId));
    return entry ? HttpResponse.json(entry.run) : notFound('Agent run not found.');
  }),

  http.post(`${API}/agent-runs/:runId/cancel`, ({ params, request }) => {
    if (!emailFromRequest(request)) {
      return unauthorized();
    }
    const entry = agentRunsStore.get(String(params.runId));
    if (!entry) {
      return notFound('Agent run not found.');
    }
    entry.run = { ...entry.run, status: 'canceled', cancelRequested: true, updatedAt: ts() };
    return HttpResponse.json(entry.run);
  }),

  // SSE progress stream. Replays the recorded events (after the requested
  // sequence) with small delays, then closes once the terminal event is sent.
  http.get(`${API}/agent-runs/:runId/events`, ({ params, request }) => {
    if (!emailFromRequest(request)) {
      return unauthorized();
    }
    const entry = agentRunsStore.get(String(params.runId));
    if (!entry) {
      return notFound('Agent run not found.');
    }
    const after = Number(new URL(request.url).searchParams.get('afterSequence') ?? '0') || 0;
    const pending = entry.events.filter((event) => event.sequence > after);
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let index = 0;
        const pushNext = () => {
          const event = pending[index++];
          if (!event) {
            controller.close();
            return;
          }
          controller.enqueue(
            encoder.encode(
              `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
            ),
          );
          setTimeout(pushNext, 350);
        };
        pushNext();
      },
    });

    return new HttpResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  }),
];

/** Tiny canned "agent" that links to relevant seeded records by keyword. */
function buildAssistantReply(prompt: string, conversationId: string) {
  const lower = prompt.toLowerCase();
  let text =
    'I looked across customers, sales, issues, actions, and SOPs. Ask me about unpaid sales, open issues, the action queue, or a specific SOP and I can link you straight to the record.';
  let link: string | null = null;

  if (lower.includes('unpaid') || lower.includes('payment')) {
    const unpaid = salesStore.find((sale) => !sale.paymentReceived);
    if (unpaid) {
      text = `The ${unpaid.customer?.fullName ?? 'customer'} sale is unpaid with a receipt total of ${unpaid.totalAmountReceipt}.`;
      link = `nova://sales/${unpaid.id}`;
    }
  } else if (lower.includes('issue') || lower.includes('suction') || lower.includes('support')) {
    const open = issuesStore.find((issue) => issue.status === 'in_assistance');
    if (open) {
      text = `There is an active issue: ${open.description}`;
      link = `nova://issues/${open.id}`;
    }
  } else if (lower.includes('role') || lower.includes('permission') || lower.includes('admin')) {
    text = 'The admin role has full system access across every domain.';
    link = 'nova://roles/admin';
  } else if (lower.includes('sop') || lower.includes('refund') || lower.includes('procedure')) {
    const sop = sopsStore[0];
    if (sop) {
      text = `The "${sop.name}" SOP applies here. ${sop.description}`;
      link = `nova://sops/${sop.id}`;
    }
  }

  const message: MessageDto = {
    id: `msg-${Date.now()}`,
    conversationId,
    role: 'assistant',
    text,
    isMCPApps: link !== null,
    MCPAppLink: link,
    MCPActive: link !== null,
    createdDate: ts(),
    createdAt: ts(),
    updatedAt: ts(),
  };

  const toolLinks = link
    ? [{ label: 'Open linked record', href: link, type: linkType(link) }]
    : undefined;

  return { message, toolLinks };
}

function linkType(link: string): 'sale' | 'issue' | 'sop' | 'customer' | 'action' | 'external' {
  if (link.startsWith('nova://sales/')) return 'sale';
  if (link.startsWith('nova://issues/')) return 'issue';
  if (link.startsWith('nova://sops/')) return 'sop';
  if (link.startsWith('nova://customers/')) return 'customer';
  if (link.startsWith('nova://actions/')) return 'action';
  return 'external';
}
