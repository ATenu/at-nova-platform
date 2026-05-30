import { config as loadDotEnv } from 'dotenv';
import { z, type ZodType, type TypeOf } from 'zod';

let dotEnvLoaded = false;

/**
 * Load `.env` into `process.env` exactly once. No-op when variables are already
 * provided by the environment (e.g. containers, CI).
 */
function ensureDotEnvLoaded(): void {
  if (!dotEnvLoaded) {
    loadDotEnv();
    dotEnvLoaded = true;
  }
}

/**
 * Parse and validate process environment against a typed schema, failing fast
 * with a readable message when configuration is missing or invalid.
 *
 * Centralizing config here means modules never read `process.env` directly and
 * the process refuses to start with invalid configuration.
 */
export function loadConfig<S extends ZodType>(schema: S): TypeOf<S> {
  ensureDotEnvLoaded();
  const result = schema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  // Launder through `unknown` so we never return an unchecked `any`; the
  // declared return type keeps each caller's config precisely typed.
  const data: unknown = result.data;
  return data;
}

/** Coerce common boolean-ish env strings ("true"/"false"/"1"/"0") to boolean. */
export const booleanFromEnv = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

/** Parse a comma-separated env value into a trimmed, non-empty string array. */
export const csvFromEnv = z.string().transform((value) =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0),
);
