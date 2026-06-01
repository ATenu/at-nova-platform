import type { Request, Response } from 'express';
import { describeSchema } from '../schema/describe-schema';
import type { ResourceServer } from '../auth/resource-server';
import { toSafeError } from '../errors';

/**
 * Snapshot-free capability/schema discovery for trusted internal services.
 *
 * The SQL analyst agent builds its Agent Card from this on startup, BEFORE any
 * user run (and therefore any entitlement snapshot) exists, so the orchestrator
 * can advertise an accurate, MCP-derived data surface. Access is still pinned to
 * the standard inbound auth (token signature/issuer/audience + `azp` allowlist),
 * so only the agent — never a user token, never another service — may read it.
 *
 * It returns ONLY the curated, allowlist-derived view metadata (names, columns,
 * types, owner-scoping, PII flags) from `describeSchema()` — never DB rows and
 * never PII values — which is why it safely needs no per-run snapshot.
 */
export async function handleCatalog(
  req: Request,
  res: Response,
  resourceServer: ResourceServer,
): Promise<void> {
  try {
    await resourceServer.verify(req.header('authorization'));
  } catch (error) {
    const safe = toSafeError(error);
    res.status(401).json({ error: safe.code, message: safe.message });
    return;
  }
  res.status(200).json({ views: describeSchema() });
}
