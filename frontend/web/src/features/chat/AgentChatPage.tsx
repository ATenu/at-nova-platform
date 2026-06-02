import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listConversations, getConversation } from '@/api/chat.api';
import { createAgentRun, listConversationRuns, newIdempotencyKey } from '@/api/agentRuns.api';
import {
  TERMINAL_AGENT_RUN_STATUSES,
  type AgentRunEventDto,
  type AgentRunStatus,
  type MessageDto,
} from '@/api/types';
import { queryKeys } from '@/api/queryClient';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { toUserMessage } from '@/lib/errors';
import { formatRelative } from '@/lib/dates';
import { ChatMessage } from './ChatMessage';
import { ChatComposer } from './ChatComposer';
import { useAgentRunEvents } from './useAgentRunEvents';
import { LiveRunTrace, RunTracePanel } from './RunTrace';

/**
 * Derive the run's terminal status from its events (the terminal frame's type
 * is `run.{status}`), defaulting to `completed` only if no terminal frame is
 * present. Keeps the seeded trace cache's status accurate for failed/canceled
 * runs without widening the SSE hook's API.
 */
function terminalStatusFromEvents(events: readonly AgentRunEventDto[]): AgentRunStatus {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const match = events[i]!.type.match(/^run\.(.+)$/);
    const status = match?.[1] as AgentRunStatus | undefined;
    if (status && TERMINAL_AGENT_RUN_STATUSES.includes(status)) {
      return status;
    }
  }
  return 'completed';
}

interface PendingTurn {
  readonly text: string;
  readonly status: 'sending' | 'error';
}

export function AgentChatPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeId = searchParams.get('c');
  const [pending, setPending] = useState<PendingTurn | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  // Opt-in full technical timeline (graph-node execution + authz decisions) for
  // the live stream. Toggling re-subscribes the SSE stream from sequence 0 so
  // earlier technical events are backfilled. Default off keeps the normal view.
  const [detailed, setDetailed] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  const conversations = useQuery({ queryKey: queryKeys.conversations, queryFn: listConversations });
  const conversation = useQuery({
    queryKey: activeId ? queryKeys.conversation(activeId) : ['conversations', 'none'],
    queryFn: () => getConversation(activeId!),
    enabled: Boolean(activeId),
  });

  // Maps each persisted assistant message to the run whose tool/agent activity
  // produced it, so a past turn's trace can be re-loaded from the durable event
  // store on demand. Ownership-scoped server-side (default deny).
  const conversationRuns = useQuery({
    queryKey: activeId ? queryKeys.conversationRuns(activeId) : ['conversations', 'none', 'runs'],
    queryFn: () => listConversationRuns(activeId!),
    enabled: Boolean(activeId),
  });

  const runByMessageId = useMemo(() => {
    const map = new Map<string, string>();
    for (const run of conversationRuns.data ?? []) {
      if (run.responseMessageId) {
        map.set(run.responseMessageId, run.runId);
      }
    }
    return map;
  }, [conversationRuns.data]);

  const run = useAgentRunEvents(runId, { enabled: runId !== null, detailed });

  const setActive = (id: string | null) => {
    setPending(null);
    setRunId(null);
    setSearchParams(id ? { c: id } : {}, { replace: true });
  };

  const mutation = useMutation({
    mutationFn: (message: string) =>
      createAgentRun(
        {
          message,
          ...(activeId ? { conversationId: activeId } : {}),
          context: { currentRoute: '/app/chat' },
        },
        newIdempotencyKey(),
      ),
    onSuccess: (created) => {
      setPending(null);
      setRunId(created.runId);
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
      if (created.conversationId) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.conversation(created.conversationId),
        });
        if (created.conversationId !== activeId) {
          setSearchParams({ c: created.conversationId }, { replace: true });
        }
      }
    },
    onError: () => {
      setPending((current) => (current ? { ...current, status: 'error' } : current));
    },
  });

  // When the run reaches a terminal event, refresh the conversation so the
  // assistant message the worker persisted (via the tool gateway) appears. Seed
  // the durable trace cache from the live SSE buffer so the persisted panel can
  // render immediately without waiting on another round trip.
  useEffect(() => {
    if (!runId || !run.isComplete) {
      return;
    }
    if (run.events.length > 0) {
      // Seed under the key matching the live detail level so the persisted panel
      // renders immediately without re-polling, and the default (`user`) view is
      // never seeded with technical events.
      queryClient.setQueryData(queryKeys.runTrace(runId, detailed), {
        runId,
        status: terminalStatusFromEvents(run.events),
        events: run.events,
      });
    }
    void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
    if (activeId) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversation(activeId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversationRuns(activeId) });
    }
    // A completed run may have written to any domain via `data.act.write`, but
    // the `user`-visibility stream does not enumerate which. Invalidate the
    // domain data caches so background agent writes surface without a manual
    // refresh. Failed/canceled runs are skipped (no committed writes expected).
    if (terminalStatusFromEvents(run.events) === 'completed') {
      for (const key of [
        queryKeys.actions,
        queryKeys.issues,
        queryKeys.sales,
        queryKeys.customers,
        queryKeys.sops,
        queryKeys.products,
      ]) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    }
  }, [runId, run.isComplete, run.events, activeId, queryClient, detailed]);

  const send = (message: string) => {
    setPending({ text: message, status: 'sending' });
    mutation.mutate(message);
  };

  const retry = () => {
    if (pending) {
      setPending({ ...pending, status: 'sending' });
      mutation.mutate(pending.text);
    }
  };

  const messages = useMemo<readonly MessageDto[]>(
    () => conversation.data?.messages ?? [],
    [conversation.data],
  );

  const isRunActive = runId !== null && !run.isComplete;

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, pending, run.events]);

  const visibleMessages = messages.filter((message) => message.role !== 'system');
  const hasContent = visibleMessages.length > 0 || pending !== null || isRunActive;

  return (
    <div className="chat">
      <Card className="chat-conversations">
        <div className="card-header">
          <span className="section-title">Conversations</span>
          <Button size="sm" onClick={() => setActive(null)}>
            <Icon name="plus" size={15} /> New
          </Button>
        </div>
        <div className="chat-conv-list">
          {conversations.isLoading ? (
            <LoadingState label="Loading…" />
          ) : (conversations.data?.length ?? 0) === 0 ? (
            <EmptyState icon="chat" title="No conversations" />
          ) : (
            conversations.data?.map((conv) => (
              <button
                key={conv.id}
                className={`chat-conv ${conv.id === activeId ? 'active' : ''}`}
                onClick={() => setActive(conv.id)}
              >
                <Icon name="chat" size={16} />
                <span className="stack grow" style={{ gap: 1, minWidth: 0 }}>
                  <span className="truncate text-sm" style={{ fontWeight: 600 }}>
                    {conv.title ?? `Conversation ${conv.id.slice(0, 6)}`}
                  </span>
                  <span className="subtle" style={{ fontSize: 11 }}>
                    {formatRelative(conv.createdDate)}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </Card>

      <Card className="chat-window">
        <div className="chat-thread" ref={threadRef}>
          {activeId && conversation.isLoading ? (
            <LoadingState label="Loading conversation…" />
          ) : activeId && conversation.isError ? (
            <ErrorState description={toUserMessage(conversation.error)} onRetry={() => conversation.refetch()} />
          ) : !hasContent ? (
            <div style={{ margin: 'auto' }}>
              <EmptyState
                icon="sparkles"
                title="Chat with Nova"
                description="Ask about open issues, unpaid sales, customers, action queues, or SOPs. The agent can link you straight to the right record."
              />
            </div>
          ) : (
            <>
              {visibleMessages.map((message) => {
                const traceRunId =
                  message.role === 'assistant' ? runByMessageId.get(message.id) : undefined;
                return (
                  <ChatMessage
                    key={message.id}
                    message={message}
                    footer={traceRunId ? <RunTracePanel runId={traceRunId} /> : undefined}
                  />
                );
              })}
              {pending && pending.status === 'error' ? (
                <>
                  <div className="chat-msg user">
                    <span className="chat-role-ico" aria-hidden>
                      <Icon name="user" size={16} />
                    </span>
                    <div className="chat-bubble">{pending.text}</div>
                  </div>
                  <div className="row" style={{ gap: 10 }}>
                    <span className="text-sm" style={{ color: 'var(--danger)' }}>
                      Message failed to send.
                    </span>
                    <Button size="sm" onClick={retry}>
                      <Icon name="refresh" size={14} /> Retry
                    </Button>
                  </div>
                </>
              ) : null}
              {isRunActive ? (
                <div className="chat-msg assistant">
                  <span className="chat-role-ico" aria-hidden>
                    <Icon name="sparkles" size={16} />
                  </span>
                  <div className="stack" style={{ gap: 6, minWidth: 0, flex: 1 }}>
                    <LiveRunTrace
                      events={run.events}
                      detailed={detailed}
                      onToggleDetailed={() => setDetailed((value) => !value)}
                    >
                      {run.error ? (
                        <span className="text-sm" style={{ color: 'var(--danger)', marginTop: 6 }}>
                          {run.error}
                        </span>
                      ) : null}
                    </LiveRunTrace>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
        <ChatComposer disabled={isRunActive || pending?.status === 'sending'} onSend={send} />
      </Card>
    </div>
  );
}
