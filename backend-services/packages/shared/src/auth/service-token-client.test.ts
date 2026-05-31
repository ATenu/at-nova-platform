import { ServiceTokenClient, ServiceTokenError } from './service-token-client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ServiceTokenClient', () => {
  const baseConfig = {
    tokenUrl: 'https://keycloak.local/realms/nova/protocol/openid-connect/token',
    clientId: 'nova-api',
    clientSecret: 'secret',
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('requests a client_credentials token and caches it', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ access_token: 'tok-1', expires_in: 300 }));
    const client = new ServiceTokenClient(baseConfig);

    expect(await client.getToken()).toBe('tok-1');
    expect(await client.getToken()).toBe('tok-1');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [, init] = fetchSpy.mock.calls[0]!;
    const body = (init as RequestInit).body as URLSearchParams;
    expect(body.get('grant_type')).toBe('client_credentials');
    expect(body.get('client_id')).toBe('nova-api');
  });

  it('re-fetches after invalidate', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-1', expires_in: 300 }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-2', expires_in: 300 }));
    const client = new ServiceTokenClient(baseConfig);

    expect(await client.getToken()).toBe('tok-1');
    client.invalidate();
    expect(await client.getToken()).toBe('tok-2');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('throws a typed error on a non-OK response', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ error: 'nope' }, 401));
    const client = new ServiceTokenClient(baseConfig);
    await expect(client.getToken()).rejects.toBeInstanceOf(ServiceTokenError);
  });

  it('throws when the response has no access token', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ expires_in: 300 }));
    const client = new ServiceTokenClient(baseConfig);
    await expect(client.getToken()).rejects.toBeInstanceOf(ServiceTokenError);
  });
});
