import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { listIssues } from '@/api/issues.api';
import { queryKeys } from '@/api/queryClient';
import type { CustomerIssueDto, CustomerIssueStatus } from '@/api/types';
import { CUSTOMER_ISSUE_STATUSES } from '@/api/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { PermissionGate } from '@/components/layout/PermissionGate';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { DataTable, type Column } from '@/components/ui/Table';
import { Select } from '@/components/ui/FormField';
import { IssueStatusBadge } from '@/components/ui/StatusBadge';
import { Badge } from '@/components/ui/Badge';
import { Pagination } from '@/components/ui/Pagination';
import { TableSkeleton, EmptyState, ErrorState } from '@/components/ui/states';
import { formatDate, formatRelative } from '@/lib/dates';
import { toUserMessage } from '@/lib/errors';

const STATUS_LABELS: Record<CustomerIssueStatus, string> = {
  in_assistance: 'In assistance',
  rejected: 'Rejected',
  completed: 'Completed',
};

export function IssuesPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<CustomerIssueStatus | 'all'>('all');
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: [...queryKeys.issues, { status, page }],
    queryFn: () => listIssues({ page, ...(status === 'all' ? {} : { status }) }),
  });

  const columns: ReadonlyArray<Column<CustomerIssueDto>> = [
    {
      key: 'customer',
      header: 'Customer',
      render: (issue) => issue.sale?.customer?.fullName ?? '—',
    },
    {
      key: 'description',
      header: 'Description',
      render: (issue) => (
        <span className="truncate" style={{ maxWidth: 320, display: 'inline-block' }}>
          {issue.description}
        </span>
      ),
    },
    { key: 'raised', header: 'Raised', render: (issue) => formatDate(issue.dateRaised), width: 120 },
    {
      key: 'updated',
      header: 'Last update',
      render: (issue) => formatRelative(issue.dateLastUpdate),
      width: 130,
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (issue) => <Badge tone="neutral">{issue.issueActions?.length ?? 0}</Badge>,
    },
    { key: 'status', header: 'Status', render: (issue) => <IssueStatusBadge status={issue.status} /> },
  ];

  return (
    <>
      <PageHeader
        title="Customer issues"
        description="Track and resolve customer issues and their actions."
        actions={
          <PermissionGate anyOf={['create-issues']}>
            <Link to="/app/issues/new" className="btn btn-primary">
              <Icon name="plus" size={16} /> Create issue
            </Link>
          </PermissionGate>
        }
      />

      <div className="toolbar">
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as CustomerIssueStatus | 'all');
            setPage(1);
          }}
          style={{ maxWidth: 200 }}
        >
          <option value="all">All statuses</option>
          {CUSTOMER_ISSUE_STATUSES.map((value) => (
            <option key={value} value={value}>
              {STATUS_LABELS[value]}
            </option>
          ))}
        </Select>
      </div>

      <Card>
        {query.isLoading ? (
          <TableSkeleton columns={6} />
        ) : query.isError ? (
          <ErrorState description={toUserMessage(query.error)} onRetry={() => query.refetch()} />
        ) : (query.data?.items.length ?? 0) === 0 ? (
          <EmptyState icon="issues" title="No issues found" />
        ) : (
          <DataTable
            columns={columns}
            rows={query.data?.items ?? []}
            rowKey={(issue) => issue.id}
            onRowClick={(issue) => navigate(`/app/issues/${issue.id}`)}
          />
        )}
      </Card>

      <Pagination page={query.data?.page ?? 1} totalPages={query.data?.totalPages ?? 1} onPageChange={setPage} />
    </>
  );
}
