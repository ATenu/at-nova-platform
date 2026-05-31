import RedisMock from 'ioredis-mock';
import { createCacheClient } from './cache';
import type { RedisConnection } from './redis-client';

function connectionFor(client: InstanceType<typeof RedisMock>): RedisConnection {
  return {
    client: client as unknown as RedisConnection['client'],
    namespace: 'test',
    ping: async () => true,
    quit: async () => {},
  };
}

describe('createCacheClient', () => {
  it('round-trips JSON values and deletes keys', async () => {
    const client = new RedisMock();
    const cache = createCacheClient(connectionFor(client));

    await cache.set('user:1', { id: 1, name: 'Ada' });
    expect(await cache.get<{ id: number; name: string }>('user:1')).toEqual({ id: 1, name: 'Ada' });

    await cache.del('user:1');
    expect(await cache.get('user:1')).toBeNull();

    await client.quit();
  });

  it('stores values with a TTL and returns null for missing keys', async () => {
    const client = new RedisMock();
    const cache = createCacheClient(connectionFor(client));

    await cache.set('answer', 42, 60);
    expect(await cache.get<number>('answer')).toBe(42);
    expect(await cache.get('missing')).toBeNull();

    await client.quit();
  });
});
