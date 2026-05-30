import { MessageRole, type Conversation, type Message } from '@nova/database';

export interface MessageDto {
  readonly id: string;
  readonly conversationId: string;
  readonly role: string;
  readonly text: string;
  readonly isMCPApps: boolean;
  readonly MCPAppLink: string | null;
  readonly MCPActive: boolean | null;
  readonly createdDate: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ConversationDto {
  readonly id: string;
  readonly userId: string;
  readonly title?: string | undefined;
  readonly createdDate: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly messages?: readonly MessageDto[] | undefined;
}

export function toMessageDto(message: Message): MessageDto {
  return {
    id: message.id,
    conversationId: message.conversationId,
    role: message.role,
    text: message.text,
    isMCPApps: message.isMCPApps,
    MCPAppLink: message.MCPAppLink,
    MCPActive: message.MCPActive,
    createdDate: message.createdDate.toISOString(),
    createdAt: message.createdAt.toISOString(),
    updatedAt: message.updatedAt.toISOString(),
  };
}

function deriveTitle(messages: readonly Message[] | undefined): string | undefined {
  const firstUser = messages?.find((message) => message.role === MessageRole.USER);
  if (!firstUser) {
    return undefined;
  }
  const text = firstUser.text.trim();
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

export function toConversationDto(conversation: Conversation): ConversationDto {
  const messages = conversation.messages
    ? [...conversation.messages]
        .sort((a, b) => a.createdDate.getTime() - b.createdDate.getTime())
        .map(toMessageDto)
    : undefined;
  return {
    id: conversation.id,
    userId: conversation.userId,
    title: deriveTitle(conversation.messages),
    createdDate: conversation.createdDate.toISOString(),
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
    messages,
  };
}
