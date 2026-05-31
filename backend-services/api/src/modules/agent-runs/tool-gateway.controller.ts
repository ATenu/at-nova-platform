import type { Request, Response } from 'express';
import type { ToolGatewayService } from './tool-gateway.service';
import type { FinalizeBody, ToolCallBody, ToolCallParams } from './tool-gateway.schema';

export class ToolGatewayController {
  constructor(private readonly service: ToolGatewayService) {}

  getPrompt = async (req: Request, res: Response): Promise<void> => {
    const { runId } = req.params as unknown as ToolCallParams;
    const result = await this.service.getPrompt(runId);
    res.json(result);
  };

  execute = async (req: Request, res: Response): Promise<void> => {
    const { runId } = req.params as unknown as ToolCallParams;
    const body = req.body as ToolCallBody;
    const result = await this.service.executeCapability({
      runId,
      capabilityId: body.capabilityId,
      input: body.input,
    });
    res.json(result);
  };

  finalize = async (req: Request, res: Response): Promise<void> => {
    const { runId } = req.params as unknown as ToolCallParams;
    const body = req.body as FinalizeBody;
    const result = await this.service.finalizeRun({ runId, text: body.text, links: body.links });
    res.json(result);
  };
}
