import express, { type Express, type RequestHandler } from 'express';
import request from 'supertest';
import { ConflictError } from '@nova/shared';
import type { AuthContext } from '../../auth/auth-context';
import { createErrorHandler } from '../../http/error-handler';
import { createAdminAgentRouter } from './admin-agent.routes';
import type { AdminAgentService } from './admin-agent.service';

const sampleDto = {
  name: 'at-usecase-x',
  displayName: 'Use-case X',
  description: null,
  baseUrl: 'https://x.internal',
  audience: 'nova-agent-x',
  source: 'admin' as const,
  status: 'onboarded' as const,
  enabled: true,
  version: '1.0.0',
  tags: [],
  skills: [],
  registeredAt: '2026-06-01T00:00:00.000Z',
  lastSeenAt: '2026-06-01T00:00:00.000Z',
  onboardedBy: 'kc-admin',
  onboardedAt: '2026-06-01T00:00:00.000Z',
  lastCardFetchAt: '2026-06-01T00:00:00.000Z',
  lastError: null,
};

function authWith(permissions: string[]): AuthContext {
  return {
    subject: 'kc-admin',
    issuer: 'https://keycloak.local/realms/nova',
    audience: ['nova-api'],
    email: 'admin@test.com',
    username: 'admin',
    givenName: 'Test',
    familyName: 'Admin',
    roles: ['admin'],
    permissions: new Set(permissions),
    scopes: [],
  };
}

function buildApp(opts: { permissions?: string[] | null; service?: Partial<AdminAgentService> }): {
  app: Express;
  service: jest.Mocked<Pick<AdminAgentService, 'list' | 'get' | 'onboard' | 'setEnabled' | 'remove'>>;
} {
  const service = {
    list: jest.fn(async () => [sampleDto]),
    get: jest.fn(async () => sampleDto),
    onboard: jest.fn(async () => sampleDto),
    setEnabled: jest.fn(async () => sampleDto),
    remove: jest.fn(async () => undefined),
    ...opts.service,
  } as unknown as jest.Mocked<
    Pick<AdminAgentService, 'list' | 'get' | 'onboard' | 'setEnabled' | 'remove'>
  >;

  const authenticate: RequestHandler = (req, _res, next) => {
    if (opts.permissions !== null) {
      req.auth = authWith(opts.permissions ?? []);
    }
    next();
  };

  const app = express();
  app.use(express.json());
  app.use(
    '/admin/agents',
    createAdminAgentRouter({ authenticate, service: service as unknown as AdminAgentService }),
  );
  app.use(createErrorHandler());
  return { app, service };
}

describe('admin agent routes (authz matrix)', () => {
  it('401 when unauthenticated on a read', async () => {
    const { app } = buildApp({ permissions: null });
    expect((await request(app).get('/admin/agents')).status).toBe(401);
  });

  it('403 when authenticated without read-agents', async () => {
    const { app } = buildApp({ permissions: [] });
    expect((await request(app).get('/admin/agents')).status).toBe(403);
  });

  it('200 list with read-agents', async () => {
    const { app, service } = buildApp({ permissions: ['read-agents'] });
    const res = await request(app).get('/admin/agents');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(service.list).toHaveBeenCalled();
  });

  it('403 on onboard with only read-agents (write required)', async () => {
    const { app, service } = buildApp({ permissions: ['read-agents'] });
    const res = await request(app)
      .post('/admin/agents/onboard')
      .send({ hostUrl: 'https://x.internal', audience: 'nova-agent-x' });
    expect(res.status).toBe(403);
    expect(service.onboard).not.toHaveBeenCalled();
  });

  it('201 on onboard with write-agents', async () => {
    const { app, service } = buildApp({ permissions: ['write-agents'] });
    const res = await request(app)
      .post('/admin/agents/onboard')
      .send({ hostUrl: 'https://x.internal', audience: 'nova-agent-x' });
    expect(res.status).toBe(201);
    expect(service.onboard).toHaveBeenCalled();
  });

  it('400 on onboard with an invalid body (schema)', async () => {
    const { app, service } = buildApp({ permissions: ['write-agents'] });
    const res = await request(app).post('/admin/agents/onboard').send({ hostUrl: 'nope' });
    expect(res.status).toBe(400);
    expect(service.onboard).not.toHaveBeenCalled();
  });

  it('409 surfaced when the service rejects a self-source mutation', async () => {
    const { app } = buildApp({
      permissions: ['write-agents'],
      service: {
        remove: jest.fn(async () => {
          throw new ConflictError('Self-registered agents cannot be managed here.');
        }),
      },
    });
    expect((await request(app).delete('/admin/agents/at-sql-analyser')).status).toBe(409);
  });

  it('204 on a successful delete', async () => {
    const { app, service } = buildApp({ permissions: ['write-agents'] });
    expect((await request(app).delete('/admin/agents/at-usecase-x')).status).toBe(204);
    expect(service.remove).toHaveBeenCalledWith(expect.anything(), 'at-usecase-x');
  });
});
