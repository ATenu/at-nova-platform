import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listActions } from '@/api/actions.api';
import { queryKeys } from '@/api/queryClient';
import type { IssueActionDto, IssueActionStatus } from '@/api/types';
import { ISSUE_ACTION_STATUSES } from '@/api/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Select } from '@/components/ui/FormField';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { toUserMessage } from '@/lib/errors';
import { ActionCard } from './ActionCard';

const STATUS_LABELS: Record<IssueActionStatus, string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  completed: 'Completed',
  rejected: 'Rejected',
};

export function ActionsPage() {
  const [status, setStatus] = useState<IssueActionStatus | 'all'>('all');

  const query = useQuery({
    queryKey: [...queryKeys.actions, { status }],
    queryFn: () => listActions({ pageSize: 100, ...(status === 'all' ? {} : { status }) }),
  });

  const actionsById = useMemo(() => {
    const map = new Map<string, IssueActionDto>();
    for (const action of query.data?.items ?? []) {
      map.set(action.id, action);
    }
    return map;
  }, [query.data]);

  return (
    <>
      <PageHeader title="Action queue" description="Work queue for issue actions assigned across the team." />

      <div className="toolbar">
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value as IssueActionStatus | 'all')}
          style={{ maxWidth: 200 }}
        >
          <option value="all">All statuses</option>
          {ISSUE_ACTION_STATUSES.map((value) => (
            <option key={value} value={value}>
              {STATUS_LABELS[value]}
            </option>
          ))}
        </Select>
      </div>

      {query.isLoading ? (
        <Card>
          <LoadingState />
        </Card>
      ) : query.isError ? (
        <Card>
          <ErrorState description={toUserMessage(query.error)} onRetry={() => query.refetch()} />
        </Card>
      ) : (query.data?.items.length ?? 0) === 0 ? (
        <Card>
          <EmptyState icon="actions" title="No actions in the queue" />
        </Card>
      ) : (
        <div className="stack" style={{ gap: 14 }}>
          {query.data?.items.map((action) => (
            <ActionCard
              key={action.id}
              action={action}
              actionsById={actionsById}
              invalidateKeys={[queryKeys.actions]}
            />
          ))}
        </div>
      )}
    </>
  );
}
