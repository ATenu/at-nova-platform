import type { Request, Response } from 'express';
import { UnauthenticatedError } from '@nova/shared';
import type { AgentActor, AdminAgentService } from './admin-agent.service';
import type { AgentNameParams, OnboardAgentBody, SetAgentEnabledBody } from './admin-agent.schema';

function actorOf(req: Request): AgentActor {
  if (!req.auth) {
    throw new UnauthenticatedError();
  }
  return { subject: req.auth.subject, userId: null };
}

function requestIdOf(req: Request): string | undefined {
  const id: unknown = req.id;
  return typeof id === 'string' ? id : undefined;
}

/** Thin controllers for the admin agent-registry surface (mapping only). */
export class AdminAgentController {
  constructor(private readonly service: AdminAgentService) {}

  list = async (_req: Request, res: Response): Promise<void> => {
    res.json(await this.service.list());
  };

  get = async (req: Request, res: Response): Promise<void> => {
    const { name } = req.params as unknown as AgentNameParams;
    res.json(await this.service.get(name));
  };

  onboard = async (req: Request, res: Response): Promise<void> => {
    const body = req.body as OnboardAgentBody;
    const dto = await this.service.onboard(actorOf(req), {
      ...body,
      requestId: requestIdOf(req),
    });
    res.status(201).json(dto);
  };

  setEnabled = async (req: Request, res: Response): Promise<void> => {
    const { name } = req.params as unknown as AgentNameParams;
    const { enabled } = req.body as SetAgentEnabledBody;
    res.json(await this.service.setEnabled(actorOf(req), name, enabled));
  };

  remove = async (req: Request, res: Response): Promise<void> => {
    const { name } = req.params as unknown as AgentNameParams;
    await this.service.remove(actorOf(req), name);
    res.status(204).send();
  };
}
