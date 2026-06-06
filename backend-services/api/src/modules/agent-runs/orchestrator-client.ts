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

/**
 * Admin onboarding hand-off (control plane -> orchestrator). ID/metadata only:
 * the card is fetched live by the orchestrator over native A2A. Never a secret.
 */
export interface OnboardAgentPayload {
  readonly hostUrl: string;
  readonly audience: string;
  readonly name?: string | undefined;
  readonly displayName?: string | undefined;
  readonly description?: string | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly enabled?: boolean | undefined;
  /** Acting admin subject, for audit/attribution only (never trusted for authz). */
  readonly onboardedBy?: string | undefined;
}

/** Orchestrator onboard result: the registered discovery metadata + the card. */
export interface OnboardAgentResult {
  readonly name: string;
  readonly baseUrl: string;
  readonly audience: string;
  readonly skillIds: readonly string[];
  readonly version: string | null;
  readonly status: string;
  readonly card: Record<string, unknown>;
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
// Sized for the orchestrator's single native A2A card GET (plus headroom).
const ONBOARD_TIMEOUT_MS = 20_000;
const REQUEST_ID_HEADER = 'X-Request-Id';

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

  /**
   * Drive admin onboarding through the orchestrator: it fetches the Agent Card
   * over native A2A, runs the SSRF + skill-derivation + persistence path (same
   * as self-registration), and returns the registered discovery metadata. The
   * non-2xx status is preserved so the service can pick the right API error
   * (400 bad url/no skills, 409 name collision, 502 unreachable/unparseable).
   */
  async onboardAgent(payload: OnboardAgentPayload, requestId?: string): Promise<OnboardAgentResult> {
    const token = await this.tokenClient.getToken();
    const url = `${this.config.baseUrl.replace(/\/+$/, '')}/internal/agents/onboard`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          ...(requestId ? { [REQUEST_ID_HEADER]: requestId } : {}),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.config.requestTimeoutMs ?? ONBOARD_TIMEOUT_MS),
      });
    } catch (error) {
      throw new OrchestratorClientError(
        error instanceof Error && error.name === 'TimeoutError'
          ? 'Orchestrator onboarding request timed out.'
          : 'Orchestrator onboarding request failed.',
      );
    }

    if (response.status === 401) {
      this.tokenClient.invalidate();
    }
    if (!response.ok) {
      throw new OrchestratorClientError('Orchestrator rejected the onboarding.', response.status);
    }

    return (await response.json()) as OnboardAgentResult;
  }
}
