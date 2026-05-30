import {
  KeycloakAdminError,
  type KeycloakAdminClient,
  type KeycloakRealmRole,
} from '../../auth/keycloak-admin-client';
import { KeycloakProvisioningService } from './keycloak-provisioning.service';

function fakeClient(overrides: Partial<KeycloakAdminClient> = {}): KeycloakAdminClient {
  return {
    findUserByUsername: jest.fn().mockResolvedValue(null),
    createUser: jest.fn().mockResolvedValue('kc-1'),
    setUserEnabled: jest.fn().mockResolvedValue(undefined),
    updateUserProfile: jest.fn().mockResolvedValue(undefined),
    getRealmRole: jest
      .fn()
      .mockImplementation((name: string): Promise<KeycloakRealmRole | null> =>
        Promise.resolve({ id: `id-${name}`, name }),
      ),
    getUserRealmRoles: jest.fn().mockResolvedValue([]),
    addRealmRoles: jest.fn().mockResolvedValue(undefined),
    removeRealmRoles: jest.fn().mockResolvedValue(undefined),
    sendUpdatePasswordEmail: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as KeycloakAdminClient;
}

const baseInput = {
  username: 'user@test.com',
  email: 'user@test.com',
  firstName: 'User',
  lastName: 'Test',
  enabled: true,
  roles: ['sales-user'],
};

describe('KeycloakProvisioningService', () => {
  it('degrades to a non-fatal status when no admin client is configured', async () => {
    const service = new KeycloakProvisioningService(null);
    expect(service.isEnabled).toBe(false);

    const result = await service.provisionUser(baseInput);
    expect(result).toEqual({
      keycloakId: null,
      status: 'not_found',
      lastSyncError: expect.stringContaining('not configured'),
    });
  });

  it('creates the user and reconciles realm roles', async () => {
    const client = fakeClient();
    const service = new KeycloakProvisioningService(client);

    const result = await service.provisionUser(baseInput);

    expect(result.keycloakId).toBe('kc-1');
    expect(result.status).toBe('synced');
    expect(client.addRealmRoles).toHaveBeenCalledWith('kc-1', [
      { id: 'id-sales-user', name: 'sales-user' },
    ]);
  });

  it('reports partial when a desired realm role is missing in Keycloak', async () => {
    const client = fakeClient({ getRealmRole: jest.fn().mockResolvedValue(null) });
    const service = new KeycloakProvisioningService(client);

    const result = await service.provisionUser(baseInput);
    expect(result.status).toBe('partial');
    expect(result.lastSyncError).toContain('sales-user');
  });

  it('captures errors as a safe error status', async () => {
    const client = fakeClient({
      createUser: jest.fn().mockRejectedValue(new KeycloakAdminError('boom', 500)),
    });
    const service = new KeycloakProvisioningService(client);

    const result = await service.provisionUser(baseInput);
    expect(result.status).toBe('error');
    expect(result.lastSyncError).toBe('boom');
  });

  it('removes Nova roles that are no longer desired on sync', async () => {
    const client = fakeClient({
      getUserRealmRoles: jest.fn().mockResolvedValue(['sales-user', 'admin']),
    });
    const service = new KeycloakProvisioningService(client);

    await service.syncUser({ ...baseInput, roles: ['sales-user'], existingKeycloakId: 'kc-1' });

    expect(client.removeRealmRoles).toHaveBeenCalledWith('kc-1', [{ id: 'id-admin', name: 'admin' }]);
  });
});
