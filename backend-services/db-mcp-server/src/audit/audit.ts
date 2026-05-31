import { createHash } from 'node:crypto';
import type { Logger } from '@nova/shared';

/**
 * Structured, PII-free audit trail for every tool decision. We log WHAT was
 * decided and enough to investigate (capability, decision, referenced views,
 * row count, duration, a hash of the SQL) but NEVER the raw SQL text, bound
 * parameters, or any result rows — those can contain user data. The SQL hash
 * lets operators correlate repeated queries without storing the query itself.
 */
export type AuditDecision = 'allow' | 'deny';

export interface AuditEvent {
  readonly runId: string;
  readonly ownerSubject: string;
  readonly caller: string;
  readonly capability: string;
  readonly decision: AuditDecision;
  readonly reason?: string;
  readonly relations?: readonly string[];
  readonly rowCount?: number;
  readonly truncated?: boolean;
  readonly durationMs?: number;
}

export class Auditor {
  constructor(private readonly logger: Logger) {}

  record(event: AuditEvent): void {
    this.logger.info(
      {
        audit: true,
        runId: event.runId,
        ownerSubject: event.ownerSubject,
        caller: event.caller,
        capability: event.capability,
        decision: event.decision,
        reason: event.reason ?? null,
        relations: event.relations ?? null,
        rowCount: event.rowCount ?? null,
        truncated: event.truncated ?? null,
        durationMs: event.durationMs ?? null,
      },
      'mcp.tool.decision',
    );
  }
}

/** Stable, non-reversible identifier for a SQL string (never the SQL itself). */
export function hashSql(sql: string): string {
  return `sha256:${createHash('sha256').update(sql, 'utf8').digest('hex').slice(0, 32)}`;
}
