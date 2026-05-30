/**
 * Decouples the HTTP client from the concrete auth implementation.
 *
 * The active session (real Keycloak or the dev mock) registers a token provider
 * here at startup. The API client asks the bridge for a fresh bearer token
 * before each request and reports auth failures back, without importing
 * Keycloak directly. This keeps token handling centralized in exactly one place.
 */

export interface TokenProvider {
  /** Return a valid bearer token, refreshing first if near expiry. */
  getToken: () => Promise<string | null>;
  /** Invoked when the API sees a 401, so the session can re-authenticate. */
  onUnauthorized: () => void;
}

let provider: TokenProvider | null = null;

export function setTokenProvider(next: TokenProvider): void {
  provider = next;
}

export async function getAuthToken(): Promise<string | null> {
  if (!provider) {
    return null;
  }
  return provider.getToken();
}

export function notifyUnauthorized(): void {
  provider?.onUnauthorized();
}
