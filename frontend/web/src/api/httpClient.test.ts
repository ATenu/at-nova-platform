import { describe, expect, it } from 'vitest';
import { http as mswHttp, HttpResponse } from 'msw';
import { server } from '@/mocks/server';
import { env } from '@/lib/env';
import { setTokenProvider } from '@/auth/tokenBridge';
import { http } from './httpClient';

describe('httpClient', () => {
  it('attaches the bearer token from the auth session', async () => {
    setTokenProvider({ getToken: () => Promise.resolve('test-token-123'), onUnauthorized: () => undefined });

    let receivedAuth: string | null = null;
    server.use(
      mswHttp.get(`${env.apiBaseUrl}/ping`, ({ request }) => {
        receivedAuth = request.headers.get('Authorization');
        return HttpResponse.json({ ok: true });
      }),
    );

    const result = await http.get<{ ok: boolean }>('/ping');
    expect(result.ok).toBe(true);
    expect(receivedAuth).toBe('Bearer test-token-123');
  });

  it('normalizes problem responses into typed ApiErrors', async () => {
    setTokenProvider({ getToken: () => Promise.resolve('t'), onUnauthorized: () => undefined });
    server.use(
      mswHttp.get(`${env.apiBaseUrl}/boom`, () =>
        HttpResponse.json({ code: 'forbidden', title: 'Nope', status: 403 }, { status: 403 }),
      ),
    );

    await expect(http.get('/boom')).rejects.toMatchObject({ status: 403, code: 'forbidden' });
  });
});
