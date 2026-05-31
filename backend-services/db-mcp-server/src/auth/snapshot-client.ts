import { computeSnapshotHash, type ServiceTokenClient } from '@nova/shared';
import { McpError } from '../errors';

/**
 * The verified entitlement snapshot used by the MCP server to (1) filter the
 * tool surface (Layer A), (2) re-enforce the capability gate (Layer B), and
 * (3) set the per-session ownership GUC for owner-scoped views. Carries only
 * authorization context — never tokens, prompts, rows, or PII.
 */
export interface VerifiedSnapshot {
  readonly runId: string;
  readonly ownerSubject: string;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
  readonly capabilityAllowlist: readonly string[];
  readonly expiresAtEpochS: number;
}

interface EntitlementResponse {
  readonly runId: string;
  readonly ownerSubject: string;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
  readonly capabilityAllowlist: readonly string[];
  readonly snapshotHash: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface SnapshotClientConfig {
  /** Control-plane base URL, e.g. http://nova-api:8000. */
  readonly baseUrl: string;
  /** Audience the fetch token targets (decision D5). */
  readonly audienceScope: string;
  readonly requestTimeoutMs?: number;
}

/**
 * Fetches the immutable entitlement snapshot from the control plane (decision
 * D2) and re-verifies its integrity locally — recomputing the cross-language
 * canonical hash and checking expiry — so the MCP server NEVER trusts a snapshot
 * it cannot independently verify. Default deny on any mismatch or upstream
 * failure.
 */
export class SnapshotClient {
  constructor(
    private readonly tokens: ServiceTokenClient,
    private readonly config: SnapshotClientConfig,
  ) {}

  async fetchVerified(runId: string): Promise<VerifiedSnapshot> {
    const token = await this.tokens.getToken();
    const url = `${this.config.baseUrl}/internal/agent-runs/${encodeURIComponent(runId)}/entitlement`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(this.config.requestTimeoutMs ?? 10_000),
      });
    } catch {
      throw new McpError('upstream_unavailable', 'Could not reach the entitlement service.');
    }

    if (response.status === 401) {
      this.tokens.invalidate();
    }
    if (!response.ok) {
      throw new McpError('forbidden', 'No valid entitlement snapshot for this run.');
    }

    const body = (await response.json()) as EntitlementResponse;
    return this.verify(body);
  }

  /** Recompute the canonical hash and check expiry; fail closed on mismatch. */
  private verify(body: EntitlementResponse): VerifiedSnapshot {
    const issuedAtEpochS = Math.floor(Date.parse(body.issuedAt) / 1000);
    const expiresAtEpochS = Math.floor(Date.parse(body.expiresAt) / 1000);

    const recomputed = computeSnapshotHash({
      ownerSubject: body.ownerSubject,
      roles: body.roles,
      permissions: body.permissions,
      capabilityAllowlist: body.capabilityAllowlist,
      issuedAtEpochS,
      expiresAtEpochS,
    });
    if (recomputed !== body.snapshotHash) {
      throw new McpError('forbidden', 'Entitlement snapshot failed integrity verification.');
    }
    if (Number.isNaN(expiresAtEpochS) || expiresAtEpochS * 1000 <= Date.now()) {
      throw new McpError('forbidden', 'Entitlement snapshot has expired.');
    }
    return {
      runId: body.runId,
      ownerSubject: body.ownerSubject,
      roles: body.roles,
      permissions: body.permissions,
      capabilityAllowlist: body.capabilityAllowlist,
      expiresAtEpochS,
    };
  }
}
