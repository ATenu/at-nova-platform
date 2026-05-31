import type { ServiceTokenClient } from '@nova/shared';

/**
 * Stable, ID-only payload placed on the API -> orchestrator hop. It contains no
 * prompt, document, credential, bearer token, or webhook secret. `actingSubject`
 * is a routing/diagnostic hint only; authorization is decided from the
 * integrity-checked entitlement snapshot loaded server-side.
 */
export interface EnqueueRunPayload {
  readonly runId: string;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly actingSubject: string;
  readonly entitlementSnapshotId: string;
  readonly entitlementSnapshotHash: string;
}

export interface OrchestratorClientConfig {
  readonly baseUrl: string;
  readonly requestTimeoutMs?: number;
}

export class OrchestratorClientError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'OrchestratorClientError';
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Thin client for the orchestrator task gateway. The Node API never holds broker
 * credentials; it authenticates with a short-lived, audience-restricted
 * (`nova-orchestrator`) service token and hands the gateway IDs only.
 */
export class OrchestratorClient {
  constructor(
    private readonly config: OrchestratorClientConfig,
    private readonly tokenClient: ServiceTokenClient,
  ) {}

  async enqueueRun(payload: EnqueueRunPayload): Promise<void> {
    const token = await this.tokenClient.getToken();
    const url = `${this.config.baseUrl.replace(/\/+$/, '')}/internal/runs`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          'X-Request-Id': payload.requestId,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.config.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (error) {
      throw new OrchestratorClientError(
        error instanceof Error && error.name === 'TimeoutError'
          ? 'Orchestrator request timed out.'
          : 'Orchestrator request failed.',
      );
    }

    if (response.status === 401) {
      // Token may have been rotated/expired; drop the cache so the next call re-mints.
      this.tokenClient.invalidate();
    }
    if (!response.ok && response.status !== 202) {
      throw new OrchestratorClientError('Orchestrator rejected the run.', response.status);
    }
  }
}
