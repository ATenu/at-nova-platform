import type { Request, Response } from 'express';
import { UnauthenticatedError } from '@nova/shared';
import type { ChatService } from './chat.service';
import type { ConversationIdParams } from './chat.schema';

export class ChatController {
  constructor(private readonly service: ChatService) {}

  private requireAuth(req: Request) {
    if (!req.auth) {
      throw new UnauthenticatedError();
    }
    return req.auth;
  }

  listConversations = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.listConversations(this.requireAuth(req)));
  };

  getConversation = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params as unknown as ConversationIdParams;
    res.json(await this.service.getConversation(id, this.requireAuth(req)));
  };

  createConversation = async (req: Request, res: Response): Promise<void> => {
    res.status(201).json(await this.service.createConversation(this.requireAuth(req)));
  };
}
