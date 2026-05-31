/**
 * Client-facing domain types. These mirror the backend DTOs (camelCase
 * properties; money as strings). They intentionally contain no password or
 * credential fields — authentication is owned by Keycloak, and the application
 * `users` table holds profile data only.
 */

export type UUID = string;

export type CustomerIssueStatus = 'in_assistance' | 'rejected' | 'completed';
export type IssueActionStatus = 'pending' | 'in_progress' | 'completed' | 'rejected';
export type MessageRole = 'system' | 'user' | 'assistant';

export const CUSTOMER_ISSUE_STATUSES: readonly CustomerIssueStatus[] = [
  'in_assistance',
  'rejected',
  'completed',
];

export const ISSUE_ACTION_STATUSES: readonly IssueActionStatus[] = [
  'pending',
  'in_progress',
  'completed',
  'rejected',
];

/** Standard paginated envelope returned by backend list endpoints. */
export interface PaginatedResult<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
}

export interface UserDto {
  readonly id: UUID;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly middleName?: string | null;
  readonly description?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RoleDto {
  readonly name: string;
  readonly description?: string | null;
}

export interface PermissionDto {
  readonly name: string;
  readonly description?: string | null;
}

export type KeycloakSyncStatus = 'synced' | 'partial' | 'not_found' | 'error';

export interface AdminUserDto {
  readonly id: UUID;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly middleName?: string | null;
  readonly description?: string | null;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly keycloak: {
    readonly exists: boolean;
    readonly enabled: boolean;
    readonly syncedRoles: readonly string[];
    readonly syncStatus: KeycloakSyncStatus;
    readonly lastSyncError?: string | null;
  };
}

export interface CustomerDto {
  readonly id: UUID;
  readonly email: string;
  readonly fullName: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly age: number | null;
  readonly active: boolean;
  readonly salesCount?: number;
  readonly issuesCount?: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProductDto {
  readonly id: UUID;
  readonly name: string;
  readonly description?: string | null;
  readonly category: string;
  readonly price: string;
  readonly inCatalog: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProductSoldDto {
  readonly saleId: UUID;
  readonly productId: UUID;
  readonly quantity: number;
  readonly product?: ProductDto | undefined;
}

export interface SaleDto {
  readonly id: UUID;
  readonly customerId: UUID;
  readonly customer?: CustomerDto | undefined;
  readonly discountApplied?: string | null;
  readonly date: string;
  readonly totalAmountReceipt: string;
  readonly paymentReceived: boolean;
  readonly dateOfPayment?: string | null;
  readonly productsSold?: readonly ProductSoldDto[];
  readonly issuesCount?: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CustomerIssueDto {
  readonly id: UUID;
  readonly salesId: UUID;
  readonly sale?: SaleDto | undefined;
  readonly description: string;
  readonly dateRaised: string;
  readonly dateLastUpdate: string;
  readonly status: CustomerIssueStatus;
  readonly issueActions?: readonly IssueActionDto[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface IssueActionDto {
  readonly id: UUID;
  readonly issueId: UUID;
  readonly title: string;
  readonly description: string;
  readonly status: IssueActionStatus;
  readonly updatedById?: UUID | null;
  readonly updatedAI?: boolean | null;
  readonly createdDate: string;
  readonly assignedOwnerId: UUID;
  readonly assignedOwner?: UserDto;
  readonly updatedBy?: UserDto | null;
  readonly comments?: readonly ActionCommentDto[];
  readonly dependencies?: readonly IssueActionDependencyDto[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface IssueActionDependencyDto {
  readonly actionId: UUID;
  readonly dependsOnActionId: UUID;
}

export interface ActionCommentDto {
  readonly id: UUID;
  readonly issueActionId: UUID;
  readonly userId: UUID;
  readonly user?: UserDto | undefined;
  readonly comment: string;
  readonly datetime: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SopDto {
  readonly id: UUID;
  readonly name: string;
  readonly active: boolean;
  readonly description: string;
  readonly latestVersion?: number;
  readonly details?: readonly SopDetailDto[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SopDetailDto {
  readonly sopId: UUID;
  readonly version: number;
  readonly fullText: string;
  readonly dateOfCreation: string;
  readonly createdById: UUID;
  readonly createdBy?: UserDto | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MessageDto {
  readonly id: UUID;
  readonly conversationId: UUID;
  readonly role: MessageRole;
  readonly text: string;
  readonly isMCPApps: boolean;
  readonly MCPAppLink?: string | null;
  readonly MCPActive?: boolean | null;
  readonly createdDate: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ConversationDto {
  readonly id: UUID;
  readonly userId: UUID;
  readonly title?: string;
  readonly createdDate: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly messages?: readonly MessageDto[];
}

export type EntityLinkType = 'customer' | 'sale' | 'issue' | 'action' | 'sop';

export interface AgentToolLink {
  readonly label: string;
  readonly href: string;
  readonly type: EntityLinkType | 'external';
}

/**
 * Asynchronous agent-run lifecycle (Celery execution plane). The control plane
 * accepts a run, streams `user`-visibility progress events over SSE, and exposes
 * cancellation. `internal`/`security` events never reach the client.
 */
export type AgentRunStatus =
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'expired';

export const TERMINAL_AGENT_RUN_STATUSES: readonly AgentRunStatus[] = [
  'completed',
  'failed',
  'canceled',
  'expired',
];

export interface AgentRunDto {
  readonly runId: string;
  readonly status: AgentRunStatus;
  readonly conversationId: string | null;
  readonly cancelRequested: boolean;
  readonly finalResponse: string | null;
  /** Assistant message id this run finalized to, or `null` if not finalized. */
  readonly responseMessageId: string | null;
  readonly eventsUrl: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt: string | null;
}

export interface AgentRunEventDto {
  readonly id: string;
  readonly sequence: number;
  readonly type: string;
  readonly payload: Record<string, unknown>;
  readonly createdAt: string;
}

/** Full ordered `user`-visibility trace for a completed run. */
export interface AgentRunTraceDto {
  readonly runId: string;
  readonly status: AgentRunStatus;
  readonly events: readonly AgentRunEventDto[];
}

export interface CreateAgentRunRequest {
  readonly message: string;
  readonly conversationId?: string;
  readonly context?: {
    readonly currentRoute?: string;
    readonly selectedEntity?: {
      readonly type: EntityLinkType;
      readonly id: string;
    };
  };
}
