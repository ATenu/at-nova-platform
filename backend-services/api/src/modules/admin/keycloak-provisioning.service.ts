import { isRole } from '@nova/shared';
import {
  KeycloakAdminError,
  type KeycloakAdminClient,
  type KeycloakRealmRole,
} from '../../auth/keycloak-admin-client';
import type { KeycloakSyncStatus } from '../users/user.dto';

export interface ProvisionResult {
  readonly keycloakId: string | null;
  readonly status: KeycloakSyncStatus;
  readonly lastSyncError: string | null;
}

export interface ProvisionInput {
  readonly username: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly enabled: boolean;
  readonly roles: readonly string[];
  readonly sendResetPasswordEmail?: boolean;
}

export interface SyncInput extends Omit<ProvisionInput, 'sendResetPasswordEmail'> {
  readonly existingKeycloakId: string | null;
}

const NOT_CONFIGURED: ProvisionResult = {
  keycloakId: null,
  status: 'not_found',
  lastSyncError: 'Keycloak provisioning is not configured.',
};

/**
 * Backend-driven Keycloak user provisioning. Encapsulates all Admin REST
 * interactions and reconciliation of realm-role mappings. When no admin client
 * is configured every operation degrades to a clear, non-fatal status so the
 * local profile is still managed and can be synced later.
 */
export class KeycloakProvisioningService {
  constructor(private readonly client: KeycloakAdminClient | null) {}

  get isEnabled(): boolean {
    return this.client !== null;
  }

  async provisionUser(input: ProvisionInput): Promise<ProvisionResult> {
    if (!this.client) {
      return NOT_CONFIGURED;
    }
    try {
      const keycloakId = await this.client.createUser({
        username: input.username,
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        enabled: input.enabled,
      });
      const reconcile = await this.reconcileRoles(this.client, keycloakId, input.roles);
      if (input.sendResetPasswordEmail) {
        await this.client.sendUpdatePasswordEmail(keycloakId).catch(() => undefined);
      }
      return { keycloakId, status: reconcile.status, lastSyncError: reconcile.error };
    } catch (error) {
      return { keycloakId: null, status: 'error', lastSyncError: messageOf(error) };
    }
  }

  async syncUser(input: SyncInput): Promise<ProvisionResult> {
    if (!this.client) {
      return NOT_CONFIGURED;
    }
    try {
      let keycloakId = input.existingKeycloakId;
      if (!keycloakId) {
        const existing = await this.client.findUserByUsername(input.username);
        keycloakId = existing?.id ?? null;
      }
      if (!keycloakId) {
        keycloakId = await this.client.createUser({
          username: input.username,
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          enabled: input.enabled,
        });
      }
      await this.client.setUserEnabled(keycloakId, input.enabled);
      await this.client.updateUserProfile(keycloakId, {
        firstName: input.firstName,
        lastName: input.lastName,
      });
      const reconcile = await this.reconcileRoles(this.client, keycloakId, input.roles);
      return { keycloakId, status: reconcile.status, lastSyncError: reconcile.error };
    } catch (error) {
      return {
        keycloakId: input.existingKeycloakId,
        status: 'error',
        lastSyncError: messageOf(error),
      };
    }
  }

  async setEnabled(keycloakId: string, enabled: boolean): Promise<ProvisionResult> {
    if (!this.client) {
      return NOT_CONFIGURED;
    }
    try {
      await this.client.setUserEnabled(keycloakId, enabled);
      return { keycloakId, status: 'synced', lastSyncError: null };
    } catch (error) {
      return { keycloakId, status: 'error', lastSyncError: messageOf(error) };
    }
  }

  /** Reconcile the user's Keycloak realm roles with the desired Nova roles. */
  private async reconcileRoles(
    client: KeycloakAdminClient,
    keycloakId: string,
    desired: readonly string[],
  ): Promise<{ status: KeycloakSyncStatus; error: string | null }> {
    const current = await client.getUserRealmRoles(keycloakId);
    const desiredNova = [...new Set(desired.filter(isRole))];
    const currentNova = current.filter(isRole);

    const toAdd = desiredNova.filter((role) => !currentNova.includes(role));
    const toRemove = currentNova.filter((role) => !desiredNova.includes(role));

    const addReps: KeycloakRealmRole[] = [];
    const missing: string[] = [];
    for (const role of toAdd) {
      const rep = await client.getRealmRole(role);
      if (rep) {
        addReps.push(rep);
      } else {
        missing.push(role);
      }
    }
    const removeReps: KeycloakRealmRole[] = [];
    for (const role of toRemove) {
      const rep = await client.getRealmRole(role);
      if (rep) {
        removeReps.push(rep);
      }
    }

    await client.addRealmRoles(keycloakId, addReps);
    await client.removeRealmRoles(keycloakId, removeReps);

    return missing.length > 0
      ? { status: 'partial', error: `Missing Keycloak realm roles: ${missing.join(', ')}` }
      : { status: 'synced', error: null };
  }
}

function messageOf(error: unknown): string {
  if (error instanceof KeycloakAdminError) {
    return error.message;
  }
  return 'Keycloak provisioning failed.';
}
