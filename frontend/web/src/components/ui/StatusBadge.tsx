import { Badge, type BadgeTone } from './Badge';
import type { CustomerIssueStatus, IssueActionStatus } from '@/api/types';

const ISSUE_TONE: Record<CustomerIssueStatus, BadgeTone> = {
  in_assistance: 'info',
  rejected: 'danger',
  completed: 'success',
};

const ISSUE_LABEL: Record<CustomerIssueStatus, string> = {
  in_assistance: 'In assistance',
  rejected: 'Rejected',
  completed: 'Completed',
};

const ACTION_TONE: Record<IssueActionStatus, BadgeTone> = {
  pending: 'neutral',
  in_progress: 'info',
  completed: 'success',
  rejected: 'danger',
};

const ACTION_LABEL: Record<IssueActionStatus, string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  completed: 'Completed',
  rejected: 'Rejected',
};

export function IssueStatusBadge({ status }: { status: CustomerIssueStatus }) {
  return (
    <Badge tone={ISSUE_TONE[status]} dot>
      {ISSUE_LABEL[status]}
    </Badge>
  );
}

export function ActionStatusBadge({ status }: { status: IssueActionStatus }) {
  return (
    <Badge tone={ACTION_TONE[status]} dot>
      {ACTION_LABEL[status]}
    </Badge>
  );
}

export function PaymentBadge({ paid }: { paid: boolean }) {
  return <Badge tone={paid ? 'success' : 'warning'} dot>{paid ? 'Paid' : 'Unpaid'}</Badge>;
}

export function ActiveBadge({ active }: { active: boolean }) {
  return <Badge tone={active ? 'success' : 'neutral'} dot>{active ? 'Active' : 'Inactive'}</Badge>;
}
