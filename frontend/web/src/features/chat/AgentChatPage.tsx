import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listConversations, getConversation } from '@/api/chat.api';
import { createAgentRun, newIdempotencyKey } from '@/api/agentRuns.api';
import type { AgentRunEventDto, MessageDto } from '@/api/types';
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

interface PendingTurn {
  readonly text: string;
  readonly status: 'sending' | 'error';
}

/** Render a `user`-visibility run event as a short progress line (or skip it). */
function describeEvent(event: AgentRunEventDto): string | null {
  const capability = typeof event.payload.capability === 'string' ? event.payload.capability : '';
  switch (event.type) {
    case 'run.started':
      return 'Starting…';
    case 'planner.started':
      return 'Planning your request…';
    case 'tool.call.started':
      return capability ? `Running ${capability}…` : 'Running a step…';
    case 'tool.call.completed':
      return typeof event.payload.summary === 'string' && event.payload.summary
        ? event.payload.summary
        : `Finished ${capability}.`;
    case 'tool.call.failed':
      return `A step did not complete${capability ? ` (${capability})` : ''}.`;
    case 'run.failed':
      return 'The run failed.';
    case 'run.canceled':
      return 'Run canceled.';
    default:
      return null;
  }
}

export function AgentChatPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeId = searchParams.get('c');
  const [pending, setPending] = useState<PendingTurn | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  const conversations = useQuery({ queryKey: queryKeys.conversations, queryFn: listConversations });
  const conversation = useQuery({
    queryKey: activeId ? queryKeys.conversation(activeId) : ['conversations', 'none'],
    queryFn: () => getConversation(activeId!),
    enabled: Boolean(activeId),
  });

  const run = useAgentRunEvents(runId, { enabled: runId !== null });

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
  // assistant message the worker persisted (via the tool gateway) appears. This
  // effect performs query invalidation only (no setState); `isRunActive` already
  // hides the live progress bubble once the run completes.
  useEffect(() => {
    if (runId && run.isComplete) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
      if (activeId) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.conversation(activeId) });
      }
    }
  }, [runId, run.isComplete, activeId, queryClient]);

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

  const progressLines = useMemo<readonly string[]>(() => {
    const lines: string[] = [];
    for (const event of run.events) {
      const line = describeEvent(event);
      if (line) {
        lines.push(line);
      }
    }
    return lines;
  }, [run.events]);

  const isRunActive = runId !== null && !run.isComplete;

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, pending, progressLines]);

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
              {visibleMessages.map((message) => (
                <ChatMessage key={message.id} message={message} />
              ))}
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
                  <div className="stack" style={{ gap: 6, minWidth: 0 }}>
                    {progressLines.length > 0 ? (
                      progressLines.map((line, index) => (
                        <div key={`${index}-${line}`} className="chat-bubble">
                          {line}
                        </div>
                      ))
                    ) : (
                      <div className="chat-bubble">
                        <span className="typing" aria-label="Nova is working">
                          <span /> <span /> <span />
                        </span>
                      </div>
                    )}
                    {run.error ? (
                      <span className="text-sm" style={{ color: 'var(--danger)' }}>
                        {run.error}
                      </span>
                    ) : null}
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
