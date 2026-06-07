import express, { type Express, type RequestHandler } from 'express';
import request from 'supertest';
import type { AuthContext } from '../../auth/auth-context';
import { createErrorHandler } from '../../http/error-handler';
import { createActionRouter } from './action.routes';
import type { ActionService } from './action.service';

const ISSUE_ID = '22222222-2222-2222-2222-222222222222';
const ACTION_ID = '11111111-1111-1111-1111-111111111111';

const sampleDto = {
  id: ACTION_ID,
  issueId: ISSUE_ID,
  title: 'Verify refund policy',
  description: 'Check SOP and confirm eligibility.',
  status: 'pending',
  updatedById: '33333333-3333-3333-3333-333333333333',
  updatedAI: false,
  createdDate: '2026-06-01T00:00:00.000Z',
  assignedOwnerId: '33333333-3333-3333-3333-333333333333',
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
};

function authWith(permissions: string[]): AuthContext {
  return {
    subject: 'kc-support',
    issuer: 'https://keycloak.local/realms/nova',
    audience: ['nova-api'],
    roles: ['customer-support'],
    permissions: new Set(permissions),
    scopes: [],
  } as unknown as AuthContext;
}

function buildApp(opts: { permissions?: string[] | null; service?: Partial<ActionService> }): {
  app: Express;
  service: jest.Mocked<Pick<ActionService, 'createAction'>>;
} {
  const service = {
    createAction: jest.fn(async () => sampleDto),
    ...opts.service,
  } as unknown as jest.Mocked<Pick<ActionService, 'createAction'>>;

  const authenticate: RequestHandler = (req, _res, next) => {
    if (opts.permissions !== null) {
      req.auth = authWith(opts.permissions ?? []);
    }
    next();
  };

  const app = express();
  app.use(express.json());
  app.use('/', createActionRouter({ authenticate, service: service as unknown as ActionService }));
  app.use(createErrorHandler());
  return { app, service };
}

const validBody = {
  issueId: ISSUE_ID,
  title: 'Verify refund policy',
  description: 'Check SOP and confirm eligibility.',
};

describe('action routes (create authz matrix)', () => {
  it('401 when unauthenticated', async () => {
    const { app } = buildApp({ permissions: null });
    expect((await request(app).post('/').send(validBody)).status).toBe(401);
  });

  it('403 when authenticated without create-actions', async () => {
    const { app } = buildApp({ permissions: ['read-actions'] });
    expect((await request(app).post('/').send(validBody)).status).toBe(403);
  });

  it('201 when entitled', async () => {
    const { app, service } = buildApp({ permissions: ['create-actions'] });
    const res = await request(app).post('/').send(validBody);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: ACTION_ID, title: sampleDto.title });
    expect(service.createAction).toHaveBeenCalledWith(validBody, expect.anything());
  });
});
