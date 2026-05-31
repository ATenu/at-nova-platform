import type { Request, Response } from 'express';
import { TERMINAL_AGENT_RUN_STATUSES, type AgentRunStatus } from '@nova/database';
import { UnauthenticatedError, ValidationError } from '@nova/shared';
import type { AuthContext } from '../../auth/auth-context';
import type { AgentRunService } from './agent-run.service';
import {
  idempotencyKeySchema,
  type CreateAgentRunBody,
  type ListEventsQuery,
  type RunIdParams,
} from './agent-run.schema';

const SSE_POLL_INTERVAL_MS = 1000;

export class AgentRunController {
  constructor(private readonly service: AgentRunService) {}

  private requireAuth(req: Request): AuthContext {
    if (!req.auth) {
      throw new UnauthenticatedError();
    }
    return req.auth;
  }

  create = async (req: Request, res: Response): Promise<void> => {
    const auth = this.requireAuth(req);
    const idempotencyResult = idempotencyKeySchema.safeParse(req.header('Idempotency-Key'));
    if (!idempotencyResult.success) {
      throw new ValidationError('An Idempotency-Key header is required.');
    }
    const requestIdHeader = req.headers['x-request-id'];
    const dto = await this.service.createRun({
      body: req.body as CreateAgentRunBody,
      auth,
      idempotencyKey: idempotencyResult.data,
      requestId: typeof requestIdHeader === 'string' ? requestIdHeader : '',
    });
    res.status(202).json(dto);
  };

  getById = async (req: Request, res: Response): Promise<void> => {
    const { runId } = req.params as unknown as RunIdParams;
    res.json(await this.service.getRun(runId, this.requireAuth(req)));
  };

  cancel = async (req: Request, res: Response): Promise<void> => {
    const { runId } = req.params as unknown as RunIdParams;
    res.json(await this.service.cancelRun(runId, this.requireAuth(req)));
  };

  /**
   * Server-Sent Events stream of user-visibility events. Resumable via the
   * `Last-Event-ID` header (or `afterSequence` query). Only `user`-visibility
   * events are streamed; `internal`/`security` events never leave the backend.
   */
  streamEvents = async (req: Request, res: Response): Promise<void> => {
    const auth = this.requireAuth(req);
    const { runId } = req.params as unknown as RunIdParams;
    const query = req.query as unknown as ListEventsQuery;

    const lastEventId = req.header('Last-Event-ID');
    let cursor = lastEventId ? Number.parseInt(lastEventId, 10) : query.afterSequence;
    if (!Number.isFinite(cursor) || cursor < 0) {
      cursor = 0;
    }

    // Ownership is enforced before any stream bytes are written.
    const initial = await this.service.getEventBatch(runId, cursor, auth);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (batch: typeof initial): void => {
      for (const event of batch.events) {
        cursor = event.sequence;
        res.write(`id: ${event.sequence}\n`);
        res.write(`event: ${event.type}\n`);
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    };

    send(initial);

    let closed = false;
    let timer: NodeJS.Timeout | undefined;
    const stop = (): void => {
      closed = true;
      if (timer) {
        clearInterval(timer);
      }
      res.end();
    };
    req.on('close', () => {
      closed = true;
      if (timer) {
        clearInterval(timer);
      }
    });

    const isTerminal = (status: AgentRunStatus): boolean =>
      TERMINAL_AGENT_RUN_STATUSES.includes(status);

    if (isTerminal(initial.run.status as AgentRunStatus)) {
      stop();
      return;
    }

    timer = setInterval(() => {
      void (async () => {
        if (closed) {
          return;
        }
        try {
          const batch = await this.service.getEventBatch(runId, cursor, auth);
          send(batch);
          res.write(': keep-alive\n\n');
          if (isTerminal(batch.run.status as AgentRunStatus)) {
            stop();
          }
        } catch {
          stop();
        }
      })();
    }, SSE_POLL_INTERVAL_MS);
  };
}
