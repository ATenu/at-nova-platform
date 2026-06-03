/**
 * Minimal, typed Keycloak Admin REST client used for backend-driven user
 * provisioning. Authenticates as the API's confidential service-account client
 * via the `client_credentials` grant and caches the access token until shortly
 * before expiry. The browser never calls these endpoints.
 *
 * All failures surface as `KeycloakAdminError` with a safe message; tokens and
 * secrets are never logged or serialized.
 */

export interface KeycloakAdminConfig {
  readonly baseUrl: string;
  readonly realm: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface KeycloakUser {
  readonly id: string;
  readonly username: string;
  readonly email?: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly enabled: boolean;
}

export interface KeycloakRealmRole {
  readonly id: string;
  readonly name: string;
}

export interface CreateKeycloakUserInput {
  readonly username: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly enabled: boolean;
}

export class KeycloakAdminError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'KeycloakAdminError';
  }
}

const REQUEST_TIMEOUT_MS = 10_000;
const TOKEN_EXPIRY_SKEW_MS = 15_000;

export class KeycloakAdminClient {
  private cachedToken: { value: string; expiresAt: number } | null = null;

  constructor(private readonly config: KeycloakAdminConfig) {}

  private get adminBase(): string {
    return `${this.config.baseUrl}/admin/realms/${encodeURIComponent(this.config.realm)}`;
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (error) {
      throw new KeycloakAdminError(
        error instanceof Error && error.name === 'TimeoutError'
          ? 'Keycloak admin request timed out.'
          : 'Keycloak admin request failed.',
      );
    }
  }

  private async getToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAt - TOKEN_EXPIRY_SKEW_MS > now) {
      return this.cachedToken.value;
    }
    const tokenUrl = `${this.config.baseUrl}/realms/${encodeURIComponent(
      this.config.realm,
    )}/protocol/openid-connect/token`;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });
    const response = await this.fetchWithTimeout(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
    });
    if (!response.ok) {
      throw new KeycloakAdminError('Failed to obtain a Keycloak admin token.', response.status);
    }
    const json = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) {
      throw new KeycloakAdminError('Keycloak token response did not include an access token.');
    }
    this.cachedToken = {
      value: json.access_token,
      expiresAt: now + (json.expires_in ?? 60) * 1000,
    };
    return json.access_token;
  }

  private async authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.getToken();
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    headers.set('Accept', 'application/json');
    if (init.body !== undefined && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    return this.fetchWithTimeout(`${this.adminBase}${path}`, { ...init, headers });
  }

  async findUserByUsername(username: string): Promise<KeycloakUser | null> {
    const response = await this.authedFetch(
      `/users?exact=true&username=${encodeURIComponent(username)}`,
    );
    if (!response.ok) {
      throw new KeycloakAdminError('Failed to query Keycloak users.', response.status);
    }
    const users = (await response.json()) as KeycloakUser[];
    return users[0] ?? null;
  }

  async createUser(input: CreateKeycloakUserInput): Promise<string> {
    const response = await this.authedFetch('/users', {
      method: 'POST',
      body: JSON.stringify({
        username: input.username,
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        enabled: input.enabled,
        emailVerified: false,
        requiredActions: ['UPDATE_PASSWORD'],
      }),
    });
    if (response.status === 409) {
      const existing = await this.findUserByUsername(input.username);
      if (existing) {
        return existing.id;
      }
    }
    if (!response.ok && response.status !== 201) {
      throw new KeycloakAdminError('Failed to create the Keycloak user.', response.status);
    }
    const location = response.headers.get('Location');
    const id = location?.split('/').pop();
    if (id) {
      return id;
    }
    const existing = await this.findUserByUsername(input.username);
    if (!existing) {
      throw new KeycloakAdminError('Keycloak did not return the created user id.');
    }
    return existing.id;
  }

  async setUserEnabled(userId: string, enabled: boolean): Promise<void> {
    const response = await this.authedFetch(`/users/${encodeURIComponent(userId)}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    });
    if (!response.ok && response.status !== 204) {
      throw new KeycloakAdminError('Failed to update the Keycloak user.', response.status);
    }
  }

  async updateUserProfile(
    userId: string,
    profile: { readonly firstName: string; readonly lastName: string },
  ): Promise<void> {
    const response = await this.authedFetch(`/users/${encodeURIComponent(userId)}`, {
      method: 'PUT',
      body: JSON.stringify(profile),
    });
    if (!response.ok && response.status !== 204) {
      throw new KeycloakAdminError('Failed to update the Keycloak user.', response.status);
    }
  }

  async getRealmRole(name: string): Promise<KeycloakRealmRole | null> {
    const response = await this.authedFetch(`/roles/${encodeURIComponent(name)}`);
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new KeycloakAdminError('Failed to read a Keycloak realm role.', response.status);
    }
    return (await response.json()) as KeycloakRealmRole;
  }

  /**
   * Create a realm role. Idempotent: a 409 (already exists) resolves to the
   * existing role so role provisioning can be retried safely.
   */
  async createRealmRole(name: string, description?: string | null): Promise<KeycloakRealmRole> {
    const response = await this.authedFetch('/roles', {
      method: 'POST',
      body: JSON.stringify({ name, ...(description ? { description } : {}) }),
    });
    if (response.status === 409) {
      const existing = await this.getRealmRole(name);
      if (existing) {
        return existing;
      }
    }
    if (!response.ok && response.status !== 201) {
      throw new KeycloakAdminError('Failed to create the Keycloak realm role.', response.status);
    }
    const created = await this.getRealmRole(name);
    if (!created) {
      throw new KeycloakAdminError('Keycloak did not return the created realm role.');
    }
    return created;
  }

  async updateRealmRole(name: string, description: string | null): Promise<void> {
    const response = await this.authedFetch(`/roles/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify({ name, description: description ?? '' }),
    });
    if (!response.ok && response.status !== 204) {
      throw new KeycloakAdminError('Failed to update the Keycloak realm role.', response.status);
    }
  }

  /** Delete a realm role. A 404 is treated as success (already absent). */
  async deleteRealmRole(name: string): Promise<void> {
    const response = await this.authedFetch(`/roles/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
    if (!response.ok && response.status !== 204 && response.status !== 404) {
      throw new KeycloakAdminError('Failed to delete the Keycloak realm role.', response.status);
    }
  }

  async getUserRealmRoles(userId: string): Promise<readonly string[]> {
    const response = await this.authedFetch(
      `/users/${encodeURIComponent(userId)}/role-mappings/realm`,
    );
    if (!response.ok) {
      throw new KeycloakAdminError('Failed to read Keycloak role mappings.', response.status);
    }
    const roles = (await response.json()) as KeycloakRealmRole[];
    return roles.map((role) => role.name);
  }

  async addRealmRoles(userId: string, roles: readonly KeycloakRealmRole[]): Promise<void> {
    if (roles.length === 0) {
      return;
    }
    const response = await this.authedFetch(
      `/users/${encodeURIComponent(userId)}/role-mappings/realm`,
      { method: 'POST', body: JSON.stringify(roles) },
    );
    if (!response.ok && response.status !== 204) {
      throw new KeycloakAdminError('Failed to add Keycloak role mappings.', response.status);
    }
  }

  async removeRealmRoles(userId: string, roles: readonly KeycloakRealmRole[]): Promise<void> {
    if (roles.length === 0) {
      return;
    }
    const response = await this.authedFetch(
      `/users/${encodeURIComponent(userId)}/role-mappings/realm`,
      { method: 'DELETE', body: JSON.stringify(roles) },
    );
    if (!response.ok && response.status !== 204) {
      throw new KeycloakAdminError('Failed to remove Keycloak role mappings.', response.status);
    }
  }

  async sendUpdatePasswordEmail(userId: string): Promise<void> {
    const response = await this.authedFetch(
      `/users/${encodeURIComponent(userId)}/execute-actions-email`,
      { method: 'PUT', body: JSON.stringify(['UPDATE_PASSWORD']) },
    );
    // A misconfigured SMTP server should not fail provisioning; treat as best effort.
    if (!response.ok && response.status !== 204) {
      throw new KeycloakAdminError('Failed to send the Keycloak action email.', response.status);
    }
  }
}
