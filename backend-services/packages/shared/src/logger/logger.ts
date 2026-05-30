import pino, { type Logger, type LoggerOptions } from 'pino';

export type { Logger } from 'pino';

/**
 * Paths that must never appear in plaintext in logs. Pino redacts these before
 * emitting. Extend with care and keep aligned with the redaction checklist in
 * the observability standards.
 */
const DEFAULT_REDACT_PATHS: readonly string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
  'authorization',
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'clientSecret',
  'secret',
  'apiKey',
  '*.authorization',
  '*.password',
  '*.token',
];

export interface CreateLoggerOptions {
  /** Logical service name attached to every log line. */
  readonly service: string;
  /** pino log level. */
  readonly level?: string;
  /** Deployment environment, used to enable pretty output for local dev. */
  readonly environment?: string;
  /** Additional redaction paths merged with the defaults. */
  readonly redactPaths?: readonly string[];
}

/**
 * Build the single shared structured logger for a service. All modules should
 * derive child loggers from this instance rather than creating their own.
 */
export function createLogger(options: CreateLoggerOptions): Logger {
  const isDevelopment = options.environment === 'development';

  const loggerOptions: LoggerOptions = {
    level: options.level ?? 'info',
    base: { service: options.service },
    redact: {
      paths: [...DEFAULT_REDACT_PATHS, ...(options.redactPaths ?? [])],
      censor: '[REDACTED]',
    },
    formatters: {
      level: (label) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  if (isDevelopment) {
    return pino({
      ...loggerOptions,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:standard', singleLine: false },
      },
    });
  }

  return pino(loggerOptions);
}
