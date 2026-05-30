import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listConversations, getConversation, sendAgentMessage } from '@/api/chat.api';
import type { AgentChatResponse, MessageDto } from '@/api/types';
import { queryKeys } from '@/api/queryClient';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { toUserMessage } from '@/lib/errors';
import { formatRelative } from '@/lib/dates';
import { ChatMessage } from './ChatMessage';
import { ChatComposer } from './ChatComposer';

interface PendingTurn {
  readonly text: string;
  readonly status: 'sending' | 'error';
}

export function AgentChatPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeId = searchParams.get('c');
  const [pending, setPending] = useState<PendingTurn | null>(null);
  const [lastLinks, setLastLinks] = useState<AgentChatResponse['toolLinks']>();
  const threadRef = useRef<HTMLDivElement>(null);

  const conversations = useQuery({ queryKey: queryKeys.conversations, queryFn: listConversations });
  const conversation = useQuery({
    queryKey: activeId ? queryKeys.conversation(activeId) : ['conversations', 'none'],
    queryFn: () => getConversation(activeId!),
    enabled: Boolean(activeId),
  });

  const setActive = (id: string | null) => {
    setLastLinks(undefined);
    setPending(null);
    setSearchParams(id ? { c: id } : {}, { replace: true });
  };

  const mutation = useMutation({
    mutationFn: (message: string) =>
      sendAgentMessage({
        message,
        ...(activeId ? { conversationId: activeId } : {}),
        context: { currentRoute: '/app/chat' },
      }),
    onSuccess: (response) => {
      setPending(null);
      setLastLinks(response.toolLinks);
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.conversation(response.conversation.id),
      });
      if (response.conversation.id !== activeId) {
        setSearchParams({ c: response.conversation.id }, { replace: true });
      }
    },
    onError: () => {
      setPending((current) => (current ? { ...current, status: 'error' } : current));
    },
  });

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

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, pending]);

  const visibleMessages = messages.filter((message) => message.role !== 'system');
  const hasContent = visibleMessages.length > 0 || pending !== null;

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
              {visibleMessages.map((message, index) => (
                <ChatMessage
                  key={message.id}
                  message={message}
                  toolLinks={index === visibleMessages.length - 1 ? lastLinks : undefined}
                />
              ))}
              {pending ? (
                <>
                  <div className="chat-msg user">
                    <span className="chat-role-ico" aria-hidden>
                      <Icon name="user" size={16} />
                    </span>
                    <div className="chat-bubble">{pending.text}</div>
                  </div>
                  {pending.status === 'sending' ? (
                    <div className="chat-msg assistant">
                      <span className="chat-role-ico" aria-hidden>
                        <Icon name="sparkles" size={16} />
                      </span>
                      <div className="chat-bubble">
                        <span className="typing" aria-label="Nova is typing">
                          <span /> <span /> <span />
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="row" style={{ gap: 10 }}>
                      <span className="text-sm" style={{ color: 'var(--danger)' }}>
                        Message failed to send.
                      </span>
                      <Button size="sm" onClick={retry}>
                        <Icon name="refresh" size={14} /> Retry
                      </Button>
                    </div>
                  )}
                </>
              ) : null}
            </>
          )}
        </div>
        <ChatComposer disabled={pending?.status === 'sending'} onSend={send} />
      </Card>
    </div>
  );
}
