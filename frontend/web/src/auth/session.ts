import { env } from '@/lib/env';
import { keycloak, TOKEN_MIN_VALIDITY_SECONDS } from './keycloak';

/**
 * Abstraction over the authentication backend so the rest of the app does not
 * care whether it is talking to real Keycloak or the local dev mock. Exactly
 * one implementation is selected at startup based on `env.useMocks`.
 */
export interface AuthSession {
  /** Initialize the session. Resolves with whether the user is authenticated. */
  init: () => Promise<boolean>;
  /** Begin an interactive login. */
  login: () => void;
  /** Clear the session and return to the login screen. */
  logout: () => void;
  /** A valid bearer token (refreshed if needed), or null when signed out. */
  getToken: () => Promise<string | null>;
}

const MOCK_USER_KEY = 'nova.mock.user';

/** Real Keycloak-backed session. Tokens stay in adapter memory. */
function createKeycloakSession(): AuthSession {
  let initialized = false;

  return {
    async init() {
      if (!initialized) {
        await keycloak.init({
          onLoad: 'login-required',
          pkceMethod: 'S256',
          checkLoginIframe: false,
        });
        initialized = true;
      }
      return Boolean(keycloak.authenticated);
    },
    login() {
      void keycloak.login();
    },
    logout() {
      void keycloak.logout({ redirectUri: window.location.origin });
    },
    async getToken() {
      try {
        await keycloak.updateToken(TOKEN_MIN_VALIDITY_SECONDS);
        return keycloak.token ?? null;
      } catch {
        return null;
      }
    },
  };
}

/**
 * Dev-only mock session. No real authentication: the chosen seeded user's email
 * is kept in sessionStorage and encoded into a non-cryptographic bearer token
 * that the mock API reads to resolve the current user. Never used in builds
 * where `env.useMocks` is false.
 */
function createMockSession(): AuthSession {
  return {
    init() {
      return Promise.resolve(Boolean(sessionStorage.getItem(MOCK_USER_KEY)));
    },
    login() {
      // The mock login screen sets the user; nothing to redirect to.
    },
    logout() {
      sessionStorage.removeItem(MOCK_USER_KEY);
      window.location.assign('/login');
    },
    getToken() {
      const email = sessionStorage.getItem(MOCK_USER_KEY);
      return Promise.resolve(email ? `mock.${email}` : null);
    },
  };
}

export function setMockUser(email: string): void {
  sessionStorage.setItem(MOCK_USER_KEY, email);
}

export const session: AuthSession = env.useMocks
  ? createMockSession()
  : createKeycloakSession();
