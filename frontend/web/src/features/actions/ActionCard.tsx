import { useState } from 'react';
import { type QueryKey, useMutation, useQueryClient } from '@tanstack/react-query';
import type { IssueActionDto, IssueActionStatus } from '@/api/types';
import { ISSUE_ACTION_STATUSES } from '@/api/types';
import { addActionComment, updateAction } from '@/api/actions.api';
import { useAuth } from '@/auth/AuthProvider';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Avatar } from '@/components/ui/Avatar';
import { Modal } from '@/components/ui/Modal';
import { Select, TextArea } from '@/components/ui/FormField';
import { ActionStatusBadge } from '@/components/ui/StatusBadge';
import { useToast } from '@/components/ui/toast';
import { formatDateTime } from '@/lib/dates';
import { toUserMessage } from '@/lib/errors';

const STATUS_LABELS: Record<IssueActionStatus, string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  completed: 'Completed',
  rejected: 'Rejected',
};

const BLOCKING_TRANSITIONS: ReadonlySet<IssueActionStatus> = new Set(['in_progress', 'completed']);

export function ActionCard({
  action,
  actionsById,
  invalidateKeys,
}: {
  action: IssueActionDto;
  actionsById?: ReadonlyMap<string, IssueActionDto>;
  invalidateKeys: readonly QueryKey[];
}) {
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canWrite = can('write-actions');

  const [comment, setComment] = useState('');
  const [pendingStatus, setPendingStatus] = useState<IssueActionStatus | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const invalidate = () => {
    for (const key of invalidateKeys) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  };

  const statusMutation = useMutation({
    mutationFn: (status: IssueActionStatus) => updateAction(action.id, { status }),
    onSuccess: () => {
      toast.success('Action updated');
      invalidate();
    },
    onError: (error) => toast.error(toUserMessage(error)),
  });

  const commentMutation = useMutation({
    mutationFn: (text: string) =>
      addActionComment(action.id, { comment: text, datetime: new Date().toISOString() }),
    onSuccess: () => {
      setComment('');
      toast.success('Comment added');
      invalidate();
    },
    onError: (error) => toast.error(toUserMessage(error)),
  });

  const unmetDependencies = (action.dependencies ?? []).filter((dep) => {
    const target = actionsById?.get(dep.dependsOnActionId);
    return target ? target.status !== 'completed' : false;
  });

  const requestStatusChange = (status: IssueActionStatus) => {
    if (status === action.status) return;
    if (BLOCKING_TRANSITIONS.has(status) && unmetDependencies.length > 0) {
      setPendingStatus(status);
      setConfirmOpen(true);
      return;
    }
    statusMutation.mutate(status);
  };

  const confirmStatusChange = () => {
    if (pendingStatus) {
      statusMutation.mutate(pendingStatus);
    }
    setConfirmOpen(false);
    setPendingStatus(null);
  };

  return (
    <Card>
      <CardBody className="stack">
        <div className="row-between" style={{ alignItems: 'flex-start' }}>
          <div className="stack" style={{ gap: 4 }}>
            <div className="row" style={{ gap: 8 }}>
              <span style={{ fontWeight: 640 }}>{action.title}</span>
              {action.updatedAI ? (
                <Badge tone="brand">
                  <Icon name="sparkles" size={12} /> AI updated
                </Badge>
              ) : null}
            </div>
            <span className="muted text-sm">{action.description}</span>
          </div>
          <ActionStatusBadge status={action.status} />
        </div>

        <div className="row wrap" style={{ gap: 14 }}>
          {action.assignedOwner ? (
            <span className="row text-sm" style={{ gap: 7 }}>
              <Avatar name={`${action.assignedOwner.firstName} ${action.assignedOwner.lastName}`} size="sm" />
              <span className="muted">
                {action.assignedOwner.firstName} {action.assignedOwner.lastName}
              </span>
            </span>
          ) : null}
          {action.updatedBy ? (
            <span className="text-sm subtle">
              Updated by {action.updatedBy.firstName} {action.updatedBy.lastName}
            </span>
          ) : null}
        </div>

        {(action.dependencies?.length ?? 0) > 0 ? (
          <div className="text-sm">
            <span className="subtle">Depends on: </span>
            {action.dependencies!.map((dep) => {
              const target = actionsById?.get(dep.dependsOnActionId);
              const done = target?.status === 'completed';
              return (
                <Badge key={dep.dependsOnActionId} tone={done ? 'success' : 'warning'} dot>
                  {target?.title ?? dep.dependsOnActionId.slice(0, 8)}
                </Badge>
              );
            })}
          </div>
        ) : null}

        {canWrite ? (
          <div className="row" style={{ gap: 8 }}>
            <span className="field-label">Status</span>
            <Select
              value={action.status}
              style={{ maxWidth: 200 }}
              disabled={statusMutation.isPending}
              onChange={(e) => requestStatusChange(e.target.value as IssueActionStatus)}
            >
              {ISSUE_ACTION_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </Select>
          </div>
        ) : null}

        {/* Comments */}
        <div className="stack" style={{ gap: 10, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <span className="field-label">Comments ({action.comments?.length ?? 0})</span>
          {(action.comments ?? []).map((c) => (
            <div key={c.id} className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
              <Avatar name={c.user ? `${c.user.firstName} ${c.user.lastName}` : 'User'} size="sm" />
              <div className="stack grow" style={{ gap: 2 }}>
                <div className="row" style={{ gap: 8 }}>
                  <span className="text-sm" style={{ fontWeight: 600 }}>
                    {c.user ? `${c.user.firstName} ${c.user.lastName}` : 'User'}
                  </span>
                  <span className="subtle" style={{ fontSize: 11 }}>{formatDateTime(c.datetime)}</span>
                </div>
                <span className="text-sm muted">{c.comment}</span>
              </div>
            </div>
          ))}
          {canWrite ? (
            <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
              <TextArea
                className="grow"
                rows={1}
                placeholder="Add a comment…"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                style={{ minHeight: 42 }}
              />
              <Button
                variant="primary"
                disabled={comment.trim().length === 0}
                loading={commentMutation.isPending}
                onClick={() => commentMutation.mutate(comment.trim())}
              >
                <Icon name="send" size={15} />
              </Button>
            </div>
          ) : null}
        </div>
      </CardBody>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Unmet dependencies"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={confirmStatusChange}>
              Continue anyway
            </Button>
          </>
        }
      >
        <p className="text-sm">
          This action depends on {unmetDependencies.length} action
          {unmetDependencies.length === 1 ? '' : 's'} that {unmetDependencies.length === 1 ? 'is' : 'are'} not
          completed yet. The backend will perform the final validation. Continue updating the status?
        </p>
      </Modal>
    </Card>
  );
}
