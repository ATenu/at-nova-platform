import { UnauthenticatedError } from '@nova/shared';
import type { User } from '@nova/database';
import type { AuthContext } from '../../auth/auth-context';
import { resolveCurrentUser } from './current-user';
import type { UserRepository, UserWithRoles } from './user.repository';

function snapshotAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    subject: 'kc-admin',
    applicationUserId: 'user-admin',
    issuer: '',
    audience: [],
    email: undefined,
    username: undefined,
    givenName: undefined,
    familyName: undefined,
    roles: ['admin'],
    permissions: new Set(['write-actions']),
    scopes: [],
    ...overrides,
  };
}

function userWithRoles(id: string, keycloakId: string | null): UserWithRoles {
  return {
    user: { id, keycloakId } as User,
    roles: ['admin'],
  };
}

describe('resolveCurrentUser', () => {
  it('resolves a pinned application user from an entitlement snapshot without email', async () => {
    const repository = {
      findById: jest.fn(async () => userWithRoles('user-admin', 'kc-admin')),
      findByKeycloakId: jest.fn(),
      findByEmail: jest.fn(),
      create: jest.fn(),
      replaceRoles: jest.fn(),
    } as unknown as UserRepository;

    const resolved = await resolveCurrentUser(repository, snapshotAuth());

    expect(resolved.user.id).toBe('user-admin');
    expect(repository.findById).toHaveBeenCalledWith('user-admin');
    expect(repository.findByKeycloakId).not.toHaveBeenCalled();
  });

  it('fails closed when the pinned user is missing', async () => {
    const repository = {
      findById: jest.fn(async () => null),
    } as unknown as UserRepository;

    await expect(resolveCurrentUser(repository, snapshotAuth())).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });

  it('trusts the pinned user even when keycloak id differs from owner subject', async () => {
    const repository = {
      findById: jest.fn(async () => userWithRoles('user-admin', 'kc-other')),
    } as unknown as UserRepository;

    const resolved = await resolveCurrentUser(repository, snapshotAuth({ subject: 'kc-admin' }));

    expect(resolved.user.id).toBe('user-admin');
  });
});
