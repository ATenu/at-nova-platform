import { MessageRole } from '@nova/database';
import { NotFoundError } from '@nova/shared';
import type { AuthContext } from '../../auth/auth-context';
import { resolveCurrentUser } from '../users/current-user';
import type { UserRepository } from '../users/user.repository';
import type { AgentGateway, AgentToolLink, AgentTurn } from './agent-gateway';
import { toConversationDto, toMessageDto, type ConversationDto, type MessageDto } from './chat.dto';
import type { ConversationRepository } from './conversation.repository';
import type { AgentChatBody } from './chat.schema';

export interface AgentChatResponseDto {
  readonly conversation: ConversationDto;
  readonly assistantMessage: MessageDto;
  readonly toolLinks: readonly AgentToolLink[];
}

export class ChatService {
  constructor(
    private readonly conversations: ConversationRepository,
    private readonly users: UserRepository,
    private readonly agent: AgentGateway,
  ) {}

  async listConversations(auth: AuthContext): Promise<readonly ConversationDto[]> {
    const { user } = await resolveCurrentUser(this.users, auth);
    const items = await this.conversations.listForUser(user.id);
    return items.map(toConversationDto);
  }

  async getConversation(id: string, auth: AuthContext): Promise<ConversationDto> {
    const { user } = await resolveCurrentUser(this.users, auth);
    const conversation = await this.conversations.findForUser(id, user.id);
    if (!conversation) {
      throw new NotFoundError('Conversation not found.');
    }
    return toConversationDto(conversation);
  }

  async createConversation(auth: AuthContext): Promise<ConversationDto> {
    const { user } = await resolveCurrentUser(this.users, auth);
    const conversation = await this.conversations.create(user.id);
    return toConversationDto(conversation);
  }

  async sendAgentMessage(body: AgentChatBody, auth: AuthContext): Promise<AgentChatResponseDto> {
    const { user } = await resolveCurrentUser(this.users, auth);

    const conversation = body.conversationId
      ? await this.conversations.findForUser(body.conversationId, user.id)
      : await this.conversations.create(user.id);
    if (!conversation) {
      throw new NotFoundError('Conversation not found.');
    }

    const history: AgentTurn[] = (conversation.messages ?? [])
      .slice()
      .sort((a, b) => a.createdDate.getTime() - b.createdDate.getTime())
      .map((message) => ({ role: message.role, text: message.text }));

    await this.conversations.addMessage({
      conversationId: conversation.id,
      role: MessageRole.USER,
      text: body.message,
      isMCPApps: false,
      MCPAppLink: null,
      MCPActive: null,
      createdDate: new Date(),
    });

    const reply = await this.agent.respond({
      message: body.message,
      history,
      ...(body.context !== undefined ? { context: body.context } : {}),
    });

    const primaryLink = reply.links[0];
    const assistant = await this.conversations.addMessage({
      conversationId: conversation.id,
      role: MessageRole.ASSISTANT,
      text: reply.text,
      isMCPApps: reply.links.length > 0,
      MCPAppLink: primaryLink ? primaryLink.href : null,
      MCPActive: reply.links.length > 0 ? true : null,
      createdDate: new Date(),
    });

    const reloaded = await this.conversations.findForUser(conversation.id, user.id);
    return {
      conversation: toConversationDto(reloaded ?? conversation),
      assistantMessage: toMessageDto(assistant),
      toolLinks: reply.links,
    };
  }
}
