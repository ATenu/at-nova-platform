import { parseRedisUrl, redisUrlSchema } from './redis-config';

describe('parseRedisUrl', () => {
  it('enables TLS for rediss:// URLs', () => {
    const info = parseRedisUrl('rediss://:secret@cache.example.com:6380');
    expect(info.tls).toBe(true);
    expect(info.host).toBe('cache.example.com');
    expect(info.port).toBe(6380);
  });

  it('does not enable TLS for plaintext redis:// URLs', () => {
    const info = parseRedisUrl('redis://redis-cache:6379');
    expect(info.tls).toBe(false);
    expect(info.host).toBe('redis-cache');
    expect(info.port).toBe(6379);
  });

  it('defaults the port to 6379 when omitted', () => {
    expect(parseRedisUrl('redis://redis-cache').port).toBe(6379);
  });
});

describe('redisUrlSchema', () => {
  it('accepts redis:// and rediss:// URLs', () => {
    expect(redisUrlSchema.safeParse('redis://host:6379').success).toBe(true);
    expect(redisUrlSchema.safeParse('rediss://host:6379').success).toBe(true);
  });

  it('rejects non-redis schemes', () => {
    expect(redisUrlSchema.safeParse('http://host:6379').success).toBe(false);
    expect(redisUrlSchema.safeParse('not-a-url').success).toBe(false);
  });
});
