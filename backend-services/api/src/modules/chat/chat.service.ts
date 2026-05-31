import { NotFoundError } from '@nova/shared';
import type { AuthContext } from '../../auth/auth-context';
import { resolveCurrentUser } from '../users/current-user';
import type { UserRepository } from '../users/user.repository';
import { toConversationDto, type ConversationDto } from './chat.dto';
import type { ConversationRepository } from './conversation.repository';

/**
 * Conversation persistence for the authenticated user. Agent turns are produced
 * asynchronously by the orchestration execution plane: the chat entrypoint
 * (`POST /a2a/chat`) creates an agent run, and the worker persists the assistant
 * message back through the internal tool gateway. This service therefore only
 * owns conversation reads/creation, never agent reasoning.
 */
export class ChatService {
  constructor(
    private readonly conversations: ConversationRepository,
    private readonly users: UserRepository,
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
}
