import { createRedisConnection } from './redis-client';
import type { Logger } from '../logger/logger';

type ChildBindings = Record<string, unknown>;

function createLoggerSpy(): { logger: Logger; childCalls: ChildBindings[] } {
  const childCalls: ChildBindings[] = [];
  const noop = (): void => {};
  const logger = {
    child: (bindings: ChildBindings): Logger => {
      childCalls.push(bindings);
      return logger;
    },
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
  } as unknown as Logger;
  return { logger, childCalls };
}

describe('createRedisConnection', () => {
  it('binds only non-secret coordinates to the logger, never the password', () => {
    const { logger, childCalls } = createLoggerSpy();
    // lazyConnect avoids a real network connection in unit tests.
    const connection = createRedisConnection({
      url: 'rediss://:sup3rs3cret@cache.internal:6380',
      namespace: 'cache',
      logger,
      lazyConnect: true,
    });

    try {
      expect(childCalls).toHaveLength(1);
      expect(childCalls[0]).toMatchObject({
        component: 'redis',
        namespace: 'cache',
        host: 'cache.internal',
        port: 6380,
      });
      // The password must never reach the logging bindings.
      expect(JSON.stringify(childCalls)).not.toContain('sup3rs3cret');
    } finally {
      connection.client.disconnect();
    }
  });

  it('exposes the namespace on the connection', () => {
    const { logger } = createLoggerSpy();
    const connection = createRedisConnection({
      url: 'redis://redis-cache:6379',
      namespace: 'cache',
      logger,
      lazyConnect: true,
    });
    try {
      expect(connection.namespace).toBe('cache');
    } finally {
      connection.client.disconnect();
    }
  });
});
