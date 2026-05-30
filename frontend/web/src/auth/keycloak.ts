import Keycloak from 'keycloak-js';
import { env } from '@/lib/env';

/**
 * Single Keycloak adapter instance for the app. Tokens are held in memory by
 * the adapter (never written to localStorage by us), and refreshed on demand
 * before API calls. The browser never calls Keycloak Admin REST APIs.
 */
export const keycloak = new Keycloak({
  url: env.keycloakUrl,
  realm: env.keycloakRealm,
  clientId: env.keycloakClientId,
});

/** Seconds of remaining validity below which the token is proactively refreshed. */
export const TOKEN_MIN_VALIDITY_SECONDS = 30;
