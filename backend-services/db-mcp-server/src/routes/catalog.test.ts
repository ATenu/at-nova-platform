import type { Request, Response } from 'express';
import { handleCatalog } from './catalog';
import type { ResourceServer, VerifiedCaller } from '../auth/resource-server';
import { McpError } from '../errors';

/** Resource server that accepts only the SQL analyst's token (mirrors prod azp pinning). */
function fakeResourceServer(validToken: string): ResourceServer {
  return {
    verify: async (header: string | undefined): Promise<VerifiedCaller> => {
      if (header === `Bearer ${validToken}`) {
        return { azp: 'nova-agent-sql-analyst', subject: 'svc-sql-analyst' };
      }
      throw new McpError('unauthenticated', 'The token was issued to an unauthorized party.');
    },
  } as unknown as ResourceServer;
}

interface CapturedResponse {
  status: number | null;
  body: unknown;
  res: Response;
}

function fakeResponse(): CapturedResponse {
  const captured: CapturedResponse = { status: null, body: undefined, res: undefined as unknown as Response };
  const res = {
    status(code: number): Response {
      captured.status = code;
      return res;
    },
    json(payload: unknown): Response {
      captured.body = payload;
      return res;
    },
  } as unknown as Response;
  captured.res = res;
  return captured;
}

function fakeRequest(authorization?: string): Request {
  return {
    header: (name: string): string | undefined =>
      name.toLowerCase() === 'authorization' ? authorization : undefined,
  } as unknown as Request;
}

describe('handleCatalog', () => {
  it('rejects a request without a bearer token (401)', async () => {
    const rs = fakeResourceServer('good-token');
    const captured = fakeResponse();
    await handleCatalog(fakeRequest(undefined), captured.res, rs);
    expect(captured.status).toBe(401);
  });

  it('rejects a token from an unauthorized party (401)', async () => {
    const rs = fakeResourceServer('good-token');
    const captured = fakeResponse();
    await handleCatalog(fakeRequest('Bearer wrong-token'), captured.res, rs);
    expect(captured.status).toBe(401);
  });

  it('returns the curated views with columns and PII flags for the authorized agent', async () => {
    const rs = fakeResourceServer('good-token');
    const captured = fakeResponse();
    await handleCatalog(fakeRequest('Bearer good-token'), captured.res, rs);
    expect(captured.status).toBe(200);
    const body = captured.body as {
      views: { schema: string; name: string; columns: { name: string; pii: boolean }[] }[];
    };
    expect(body.views.length).toBeGreaterThan(0);
    expect(body.views.every((view) => view.schema === 'mcp_read')).toBe(true);
    const customers = body.views.find((view) => view.name === 'customers');
    const fullName = customers?.columns.find((column) => column.name === 'full_name');
    expect(fullName?.pii).toBe(true);
  });
});
