import type { JWTPayload } from 'jose';
import { buildAuthContext } from './auth-context';

describe('buildAuthContext', () => {
  it('normalizes Keycloak claims into a typed context', () => {
    const payload: JWTPayload = {
      sub: 'user-123',
      iss: 'https://keycloak.local/realms/nova',
      aud: 'nova-api',
      email: 'sales@test.com',
      preferred_username: 'sales',
      scope: 'openid profile',
      realm_access: { roles: ['sales-user', 'offline_access'] },
    };

    const context = buildAuthContext(payload);

    expect(context.subject).toBe('user-123');
    expect(context.audience).toEqual(['nova-api']);
    expect(context.email).toBe('sales@test.com');
    expect(context.username).toBe('sales');
    expect(context.scopes).toEqual(['openid', 'profile']);
    // Unknown Keycloak roles are dropped; only platform roles remain.
    expect(context.roles).toEqual(['sales-user']);
    expect(context.permissions.has('read-customers')).toBe(true);
    expect(context.permissions.has('write-users')).toBe(false);
  });

  it('defaults safely when role claims are absent', () => {
    const context = buildAuthContext({ sub: 'x', iss: 'i', aud: ['nova-api'] });
    expect(context.roles).toEqual([]);
    expect(context.permissions.size).toBe(0);
    expect(context.scopes).toEqual([]);
  });
});
