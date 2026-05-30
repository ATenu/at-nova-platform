import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getIssue, updateIssue } from '@/api/issues.api';
import { queryKeys } from '@/api/queryClient';
import type { CustomerIssueStatus, IssueActionDto } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { FormField, Select, TextArea } from '@/components/ui/FormField';
import { IssueStatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { formatDate, formatDateTime } from '@/lib/dates';
import { toUserMessage } from '@/lib/errors';
import { ActionCard } from '@/features/actions/ActionCard';

export function IssueDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can } = useAuth();

  const query = useQuery({ queryKey: queryKeys.issue(id), queryFn: () => getIssue(id), enabled: Boolean(id) });

  const [editOpen, setEditOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<CustomerIssueStatus>('in_assistance');

  const actionsById = useMemo(() => {
    const map = new Map<string, IssueActionDto>();
    for (const action of query.data?.issueActions ?? []) {
      map.set(action.id, action);
    }
    return map;
  }, [query.data]);

  const mutation = useMutation({
    mutationFn: () =>
      updateIssue(id, { description, status, dateLastUpdate: new Date().toISOString() }),
    onSuccess: () => {
      toast.success('Issue updated');
      setEditOpen(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.issue(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.issues });
    },
    onError: (error) => toast.error(toUserMessage(error)),
  });

  if (query.isLoading) return <LoadingState label="Loading issue…" />;
  if (query.isError || !query.data) {
    return <ErrorState description={toUserMessage(query.error)} onRetry={() => query.refetch()} />;
  }

  const issue = query.data;
  const openEdit = () => {
    setDescription(issue.description);
    setStatus(issue.status);
    setEditOpen(true);
  };

  return (
    <>
      <PageHeader
        title="Issue detail"
        description={issue.sale?.customer?.fullName ? `Customer: ${issue.sale.customer.fullName}` : undefined}
        actions={
          <>
            <Button variant="ghost" onClick={() => navigate('/app/issues')}>
              <Icon name="arrowLeft" size={16} /> Back
            </Button>
            {can('write-issues') ? (
              <Button variant="primary" onClick={openEdit}>
                <Icon name="edit" size={16} /> Update issue
              </Button>
            ) : null}
          </>
        }
      />

      <div className="detail-grid">
        <div className="stack">
          <Card>
            <CardHeader title="Description" actions={<IssueStatusBadge status={issue.status} />} />
            <CardBody>
              <p style={{ margin: 0, lineHeight: 1.6 }}>{issue.description}</p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={`Actions (${issue.issueActions?.length ?? 0})`} />
            <CardBody>
              {(issue.issueActions?.length ?? 0) === 0 ? (
                <EmptyState icon="actions" title="No actions for this issue" />
              ) : (
                <div className="stack" style={{ gap: 14 }}>
                  {issue.issueActions?.map((action) => (
                    <ActionCard
                      key={action.id}
                      action={action}
                      actionsById={actionsById}
                      invalidateKeys={[queryKeys.issue(id), queryKeys.actions]}
                    />
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader title="Details" />
          <CardBody>
            <dl className="kv">
              <dt>Status</dt>
              <dd>
                <IssueStatusBadge status={issue.status} />
              </dd>
              <dt>Raised</dt>
              <dd>{formatDate(issue.dateRaised)}</dd>
              <dt>Last update</dt>
              <dd>{formatDateTime(issue.dateLastUpdate)}</dd>
              <dt>Sale</dt>
              <dd>{issue.sale?.customer?.fullName ?? issue.salesId.slice(0, 8)}</dd>
            </dl>
          </CardBody>
        </Card>
      </div>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Update issue"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={mutation.isPending} onClick={() => mutation.mutate()}>
              Save changes
            </Button>
          </>
        }
      >
        <div className="stack">
          <FormField label="Description">
            <TextArea rows={5} value={description} onChange={(e) => setDescription(e.target.value)} />
          </FormField>
          <FormField label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value as CustomerIssueStatus)}>
              <option value="in_assistance">In assistance</option>
              <option value="rejected">Rejected</option>
              <option value="completed">Completed</option>
            </Select>
          </FormField>
        </div>
      </Modal>
    </>
  );
}
