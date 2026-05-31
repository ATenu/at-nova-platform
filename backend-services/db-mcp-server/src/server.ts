import { randomUUID } from 'node:crypto';
import express, { type Express, type Request, type Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { Logger } from '@nova/shared';
import type { McpConfig } from './config';
import type { ResourceServer, VerifiedCaller } from './auth/resource-server';
import type { SnapshotClient } from './auth/snapshot-client';
import type { ReadOnlyDataSource } from './data/readonly-datasource';
import { registerTools } from './tools/register-tools';
import { toSafeError } from './errors';

const SERVER_NAME = 'nova-db-mcp-server';
const SERVER_VERSION = '0.1.0';
const RUN_ID_HEADER = 'x-nova-run-id';
const SESSION_HEADER = 'mcp-session-id';

export interface McpHttpDeps {
  readonly config: McpConfig;
  readonly logger: Logger;
  readonly resourceServer: ResourceServer;
  readonly snapshotClient: SnapshotClient;
  readonly dataSource: ReadOnlyDataSource;
}

interface Session {
  readonly transport: StreamableHTTPServerTransport;
  readonly server: McpServer;
  readonly caller: VerifiedCaller;
}

/**
 * Build the Express app hosting the MCP endpoint. Authentication happens at the
 * HTTP boundary on EVERY request. A session is created only on the MCP
 * `initialize` request (the canonical Streamable HTTP stateful pattern): the run
 * snapshot is fetched + verified once and the tool surface is bound to it for the
 * life of the (short-lived) session, so tool handlers can never see another
 * run's authorization context. The JSON response mode keeps the transport simple
 * for the single internal agent client.
 */
export function createMcpHttpApp(deps: McpHttpDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: deps.config.bodyLimit }));
  app.use(rateLimiter(deps.config.rateLimit));

  const sessions = new Map<string, Session>();

  app.get('/healthz', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.get('/readyz', (_req, res) => {
    void deps.dataSource
      .healthCheck()
      .then(() => res.status(200).json({ status: 'ready' }))
      .catch(() => res.status(503).json({ status: 'unavailable' }));
  });

  app.post('/mcp', (req, res) => {
    void handlePost(req, res, deps, sessions);
  });

  // GET (server->client stream) and DELETE (session teardown) operate on an
  // existing, authenticated session only.
  const existingSessionHandler = (req: Request, res: Response): void => {
    void handleSessionRequest(req, res, deps, sessions);
  };
  app.get('/mcp', existingSessionHandler);
  app.delete('/mcp', existingSessionHandler);

  return app;
}

async function authenticate(
  req: Request,
  res: Response,
  deps: McpHttpDeps,
): Promise<VerifiedCaller | null> {
  try {
    return await deps.resourceServer.verify(req.header('authorization'));
  } catch (error) {
    const safe = toSafeError(error);
    res.status(401).json({ error: safe.code, message: safe.message });
    return null;
  }
}

async function handlePost(
  req: Request,
  res: Response,
  deps: McpHttpDeps,
  sessions: Map<string, Session>,
): Promise<void> {
  // Every request is independently authenticated (a session never weakens auth).
  const caller = await authenticate(req, res, deps);
  if (!caller) {
    return;
  }

  const sessionId = req.header(SESSION_HEADER);
  const existing = sessionId ? sessions.get(sessionId) : undefined;
  if (existing) {
    await existing.transport.handleRequest(req, res, req.body);
    return;
  }

  if (sessionId || !isInitializeRequest(req.body)) {
    res
      .status(400)
      .json({ error: 'invalid_request', message: 'No valid session; send an initialize request.' });
    return;
  }

  // Initialize: bind the session to the run's verified entitlement snapshot.
  const runId = req.header(RUN_ID_HEADER);
  if (!runId) {
    res.status(400).json({ error: 'invalid_request', message: 'Missing X-Nova-Run-Id header.' });
    return;
  }

  let snapshot;
  try {
    snapshot = await deps.snapshotClient.fetchVerified(runId);
  } catch (error) {
    const safe = toSafeError(error);
    const status = safe.code === 'upstream_unavailable' ? 503 : 403;
    deps.logger.warn({ runId, code: safe.code }, 'snapshot fetch failed');
    res.status(status).json({ error: safe.code, message: safe.message });
    return;
  }

  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerTools(server, {
    snapshot,
    caller,
    dataSource: deps.dataSource,
    logger: deps.logger,
    sql: deps.config.sql,
  });

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
    onsessioninitialized: (id: string) => {
      sessions.set(id, { transport, server, caller });
    },
  });
  transport.onclose = () => {
    if (transport.sessionId) {
      sessions.delete(transport.sessionId);
    }
    void server.close();
  };

  try {
    // The MCP SDK's .d.ts is not authored for exactOptionalPropertyTypes; its
    // transport widens optional callbacks to `| undefined`. Cast at this single
    // third-party boundary rather than weakening the project's strict config.
    await server.connect(transport as unknown as Transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    const safe = toSafeError(error);
    deps.logger.error({ runId, code: safe.code }, 'mcp initialize failed');
    if (!res.headersSent) {
      res.status(500).json({ error: safe.code, message: safe.message });
    }
  }
}

async function handleSessionRequest(
  req: Request,
  res: Response,
  deps: McpHttpDeps,
  sessions: Map<string, Session>,
): Promise<void> {
  const caller = await authenticate(req, res, deps);
  if (!caller) {
    return;
  }
  const sessionId = req.header(SESSION_HEADER);
  const session = sessionId ? sessions.get(sessionId) : undefined;
  if (!session) {
    res.status(404).json({ error: 'invalid_request', message: 'Unknown or expired session.' });
    return;
  }
  await session.transport.handleRequest(req, res);
}

interface RateLimitState {
  count: number;
  resetAt: number;
}

/**
 * Minimal in-process fixed-window rate limiter keyed by source address. Protects
 * the data layer from accidental floods; the authoritative control is auth.
 */
function rateLimiter(config: { windowMs: number; max: number }) {
  const buckets = new Map<string, RateLimitState>();
  return (req: Request, res: Response, next: () => void): void => {
    const key = req.ip ?? 'unknown';
    const now = Date.now();
    const state = buckets.get(key);
    if (!state || state.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + config.windowMs });
      next();
      return;
    }
    if (state.count >= config.max) {
      res.status(429).json({ error: 'rate_limited', message: 'Too many requests.' });
      return;
    }
    state.count += 1;
    next();
  };
}
