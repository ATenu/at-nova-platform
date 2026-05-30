/** Domain enums shared by entities, migrations, and consumers. */

export enum CustomerIssueStatus {
  IN_ASSISTANCE = 'in_assistance',
  REJECTED = 'rejected',
  COMPLETED = 'completed',
}

export enum IssueActionStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  REJECTED = 'rejected',
}

export enum MessageRole {
  SYSTEM = 'system',
  USER = 'user',
  ASSISTANT = 'assistant',
}

/** PostgreSQL enum type names. Kept in one place so entities and the migration agree. */
export const PG_ENUM_TYPES = {
  customerIssueStatus: 'customer_issue_status_enum',
  issueActionStatus: 'issue_action_status_enum',
  messageRole: 'message_role_enum',
} as const;
