export type EntityLinkType = 'customer' | 'sale' | 'issue' | 'action' | 'sop';

export interface AgentToolLink {
  readonly label: string;
  readonly href: string;
  readonly type: EntityLinkType | 'external';
}

export interface AgentRequestContext {
  readonly currentRoute?: string | undefined;
  readonly selectedEntity?: { readonly type: EntityLinkType; readonly id: string } | undefined;
}

export interface AgentTurn {
  readonly role: 'system' | 'user' | 'assistant';
  readonly text: string;
}

export interface AgentRequest {
  readonly message: string;
  readonly history: readonly AgentTurn[];
  readonly context?: AgentRequestContext | undefined;
}

export interface AgentReply {
  readonly text: string;
  readonly links: readonly AgentToolLink[];
}

/**
 * Seam between the API and the Nova A2A agent. The HTTP API persists the
 * conversation and delegates reasoning to an implementation of this interface.
 * Swapping in the real LangGraph A2A agent later is a one-line composition
 * change; no controller/service/persistence code needs to change.
 */
export interface AgentGateway {
  respond(request: AgentRequest): Promise<AgentReply>;
}

const ENTITY_LABELS: Record<EntityLinkType, string> = {
  customer: 'customer',
  sale: 'sale',
  issue: 'issue',
  action: 'action',
  sop: 'SOP',
};

/**
 * Deterministic, dependency-free agent used until the LangGraph A2A agent is
 * available. It never calls an LLM and never fabricates data; it acknowledges
 * the request and, when the UI supplied a selected entity, surfaces a deep link
 * the frontend can resolve.
 */
export class LocalAgentGateway implements AgentGateway {
  respond(request: AgentRequest): Promise<AgentReply> {
    const links: AgentToolLink[] = [];
    const selected = request.context?.selectedEntity;
    if (selected) {
      const label = ENTITY_LABELS[selected.type];
      links.push({
        label: `Open ${label}`,
        href: `nova://${selected.type}/${selected.id}`,
        type: selected.type,
      });
    }

    const reference = selected
      ? ` I have linked the ${ENTITY_LABELS[selected.type]} you have open so you can jump straight to it.`
      : '';
    const text =
      `You asked: "${request.message.trim()}". The Nova reasoning agent is not yet connected in ` +
      `this environment, so I cannot run live tools.${reference} Once the A2A agent is wired up, ` +
      `this assistant will answer using your customer, sales, issue, action, and SOP data.`;

    return Promise.resolve({ text, links });
  }
}
