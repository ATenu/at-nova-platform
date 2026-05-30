import { Conversation, Message, type MessageRole } from '@nova/database';
import type { DataSource, Repository } from 'typeorm';

export interface CreateMessageData {
  readonly conversationId: string;
  readonly role: MessageRole;
  readonly text: string;
  readonly isMCPApps: boolean;
  readonly MCPAppLink: string | null;
  readonly MCPActive: boolean | null;
  readonly createdDate: Date;
}

export class ConversationRepository {
  private readonly conversations: Repository<Conversation>;
  private readonly messages: Repository<Message>;

  constructor(dataSource: DataSource) {
    this.conversations = dataSource.getRepository(Conversation);
    this.messages = dataSource.getRepository(Message);
  }

  async listForUser(userId: string): Promise<Conversation[]> {
    return this.conversations.find({
      where: { userId },
      relations: { messages: true },
      order: { createdDate: 'DESC' },
    });
  }

  /** Load a conversation only if it belongs to the given user (ownership check). */
  async findForUser(id: string, userId: string): Promise<Conversation | null> {
    return this.conversations.findOne({
      where: { id, userId },
      relations: { messages: true },
    });
  }

  async create(userId: string): Promise<Conversation> {
    const conversation = this.conversations.create({ userId, createdDate: new Date() });
    return this.conversations.save(conversation);
  }

  async addMessage(data: CreateMessageData): Promise<Message> {
    const message = this.messages.create(data);
    return this.messages.save(message);
  }
}
