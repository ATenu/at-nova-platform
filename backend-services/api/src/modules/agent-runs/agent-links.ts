export type EntityLinkType = 'customer' | 'sale' | 'issue' | 'action' | 'sop';

/**
 * A deep link a capability (MCP tool) surfaces so the frontend can jump straight
 * to the related record. `href` is an opaque `nova://` reference the client
 * resolves to an in-app route; capabilities never emit raw external URLs unless
 * `type` is `external`.
 */
export interface AgentToolLink {
  readonly label: string;
  readonly href: string;
  readonly type: EntityLinkType | 'external';
}
