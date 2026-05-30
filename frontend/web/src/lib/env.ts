/**
 * Centralized, validated access to the browser-exposed environment.
 *
 * Vite only exposes `VITE_`-prefixed variables to the bundle. We read them once
 * here, apply safe defaults for local development, and fail fast in production
 * builds when required values are missing, so misconfiguration surfaces early
 * instead of as obscure runtime auth failures.
 */

function readString(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  return value.trim().toLowerCase() === 'true';
}

export interface AppEnv {
  readonly apiBaseUrl: string;
  readonly keycloakUrl: string;
  readonly keycloakRealm: string;
  readonly keycloakClientId: string;
  readonly appName: string;
  /** When true, the app uses an in-browser mock API and mock auth. Dev only. */
  readonly useMocks: boolean;
  readonly isProduction: boolean;
}

function buildEnv(): AppEnv {
  const isProduction = import.meta.env.PROD;
  const useMocks = readBoolean(import.meta.env.VITE_USE_MOCKS, !isProduction);

  return {
    apiBaseUrl: readString(import.meta.env.VITE_API_BASE_URL, 'http://localhost:3000/api/v1'),
    keycloakUrl: readString(import.meta.env.VITE_KEYCLOAK_URL, 'http://localhost:8080'),
    keycloakRealm: readString(import.meta.env.VITE_KEYCLOAK_REALM, 'nova'),
    keycloakClientId: readString(import.meta.env.VITE_KEYCLOAK_CLIENT_ID, 'nova-frontend'),
    appName: readString(import.meta.env.VITE_APP_NAME, 'Nova'),
    // Hard guard: mocks must never be active in a production build.
    useMocks: useMocks && !isProduction,
    isProduction,
  };
}

export const env: AppEnv = buildEnv();
