import { useEffect, useRef, useState } from 'react';
import { env } from '@/lib/env';
import { getAuthToken, notifyUnauthorized } from '@/auth/tokenBridge';
import { TERMINAL_AGENT_RUN_STATUSES, type AgentRunEventDto } from '@/api/types';

/**
 * Subscribe to the `user`-visibility SSE stream for an agent run.
 *
 * The native `EventSource` cannot attach an `Authorization` header, so this uses
 * an authenticated `fetch` stream instead. It resumes from the last delivered
 * sequence (`Last-Event-ID`) across reconnects, and stops once a terminal
 * `run.*` event arrives. The token, prompt, and entitlement data never appear in
 * this stream — only progress events the backend has explicitly marked `user`.
 */

const MAX_RECONNECT_DELAY_MS = 10_000;
const BASE_RECONNECT_DELAY_MS = 500;

const TERMINAL_EVENT_TYPES: ReadonlySet<string> = new Set(
  TERMINAL_AGENT_RUN_STATUSES.map((status) => `run.${status}`),
);

export interface UseAgentRunEventsResult {
  readonly events: readonly AgentRunEventDto[];
  readonly isStreaming: boolean;
  readonly isComplete: boolean;
  readonly error: string | null;
}

export interface UseAgentRunEventsOptions {
  /** Replay from after this sequence on first connect (default 0). */
  readonly afterSequence?: number;
  /** Pause/disable the subscription without unmounting. */
  readonly enabled?: boolean;
}

interface ParsedFrame {
  readonly type: string;
  readonly data: string;
}

function parseFrames(buffer: string): { frames: ParsedFrame[]; rest: string } {
  const frames: ParsedFrame[] = [];
  const blocks = buffer.split('\n\n');
  // The last element is an incomplete frame; keep it buffered.
  const rest = blocks.pop() ?? '';
  for (const block of blocks) {
    let type = 'message';
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith(':') || line.length === 0) {
        continue; // keep-alive / comment
      }
      if (line.startsWith('event:')) {
        type = line.slice('event:'.length).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice('data:'.length).trim());
      }
    }
    if (dataLines.length > 0) {
      frames.push({ type, data: dataLines.join('\n') });
    }
  }
  return { frames, rest };
}

export function useAgentRunEvents(
  runId: string | null,
  options: UseAgentRunEventsOptions = {},
): UseAgentRunEventsResult {
  const { afterSequence = 0, enabled = true } = options;
  const [events, setEvents] = useState<readonly AgentRunEventDto[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset accumulated state when the target run changes (render-phase reset, the
  // pattern React recommends over a dedicated reset effect).
  const previousRunIdRef = useRef<string | null>(runId);
  if (previousRunIdRef.current !== runId) {
    previousRunIdRef.current = runId;
    setEvents([]);
    setIsComplete(false);
    setError(null);
  }

  useEffect(() => {
    if (!runId || !enabled) {
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    let cursor = afterSequence;
    let attempt = 0;
    let isTerminalSeen = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const url = `${env.apiBaseUrl.replace(/\/$/, '')}/agent-runs/${runId}/events`;

    const handleFrame = (frame: ParsedFrame): void => {
      let event: AgentRunEventDto;
      try {
        event = JSON.parse(frame.data) as AgentRunEventDto;
      } catch {
        return;
      }
      cursor = Math.max(cursor, event.sequence);
      setEvents((prev) =>
        prev.some((existing) => existing.id === event.id) ? prev : [...prev, event],
      );
      if (TERMINAL_EVENT_TYPES.has(frame.type)) {
        isTerminalSeen = true;
        setIsComplete(true);
        setIsStreaming(false);
      }
    };

    const scheduleReconnect = (): void => {
      if (cancelled) {
        return;
      }
      setIsStreaming(false);
      const delay = Math.min(BASE_RECONNECT_DELAY_MS * 2 ** attempt, MAX_RECONNECT_DELAY_MS);
      attempt += 1;
      reconnectTimer = setTimeout(() => {
        void connect();
      }, delay);
    };

    async function connect(): Promise<void> {
      const token = await getAuthToken();
      if (cancelled) {
        return;
      }
      const headers = new Headers({ Accept: 'text/event-stream' });
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
      if (cursor > 0) {
        headers.set('Last-Event-ID', String(cursor));
      }

      let response: Response;
      try {
        response = await fetch(`${url}?afterSequence=${cursor}`, {
          method: 'GET',
          headers,
          signal: controller.signal,
        });
      } catch {
        scheduleReconnect();
        return;
      }

      if (response.status === 401) {
        notifyUnauthorized();
        if (!cancelled) {
          setError('Your session has expired.');
          setIsStreaming(false);
        }
        return;
      }
      if (!response.ok || !response.body) {
        if (!cancelled) {
          setError('Unable to stream run progress.');
        }
        scheduleReconnect();
        return;
      }

      attempt = 0;
      if (!cancelled) {
        setIsStreaming(true);
        setError(null);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done || cancelled) {
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          const { frames, rest } = parseFrames(buffer);
          buffer = rest;
          for (const frame of frames) {
            handleFrame(frame);
          }
          if (cancelled) {
            break;
          }
        }
      } catch {
        // Stream interrupted; fall through to reconnect logic below.
      }

      if (!cancelled && !isTerminalSeen) {
        scheduleReconnect();
      } else if (!cancelled) {
        setIsStreaming(false);
      }
    }

    void connect();

    return () => {
      cancelled = true;
      controller.abort();
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
    };
  }, [runId, enabled, afterSequence]);

  return { events, isStreaming, isComplete, error };
}
