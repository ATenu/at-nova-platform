import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listCustomers } from '@/api/customers.api';
import { queryKeys } from '@/api/queryClient';
import type { CustomerDto } from '@/api/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/Table';
import { Avatar } from '@/components/ui/Avatar';
import { ActiveBadge } from '@/components/ui/StatusBadge';
import { SearchInput } from '@/components/ui/SearchInput';
import { Pagination } from '@/components/ui/Pagination';
import { TableSkeleton, EmptyState, ErrorState } from '@/components/ui/states';
import { toUserMessage } from '@/lib/errors';

const columns: ReadonlyArray<Column<CustomerDto>> = [
  {
    key: 'name',
    header: 'Customer',
    render: (customer) => (
      <div className="row">
        <Avatar name={customer.fullName} size="sm" />
        <div className="stack" style={{ gap: 0 }}>
          <span style={{ fontWeight: 600 }}>{customer.fullName}</span>
          <span className="subtle text-sm">{customer.email}</span>
        </div>
      </div>
    ),
  },
  { key: 'age', header: 'Age', render: (customer) => customer.age ?? '—', align: 'right' },
  {
    key: 'sales',
    header: 'Sales',
    render: (customer) => customer.salesCount ?? '—',
    align: 'right',
  },
  {
    key: 'issues',
    header: 'Issues',
    render: (customer) => customer.issuesCount ?? '—',
    align: 'right',
  },
  { key: 'status', header: 'Status', render: (customer) => <ActiveBadge active={customer.active} /> },
];

export function CustomersPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: [...queryKeys.customers, { search, page }],
    queryFn: () => listCustomers({ search: search || undefined, page }),
  });

  return (
    <>
      <PageHeader title="Customers" description="People and organisations Nova works with." />

      <div className="toolbar">
        <SearchInput value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search customers…" />
      </div>

      <Card>
        {query.isLoading ? (
          <TableSkeleton columns={5} />
        ) : query.isError ? (
          <ErrorState description={toUserMessage(query.error)} onRetry={() => query.refetch()} />
        ) : (query.data?.items.length ?? 0) === 0 ? (
          <EmptyState icon="customers" title="No customers found" description="Try a different search." />
        ) : (
          <DataTable columns={columns} rows={query.data?.items ?? []} rowKey={(customer) => customer.id} />
        )}
      </Card>

      <Pagination
        page={query.data?.page ?? 1}
        totalPages={query.data?.totalPages ?? 1}
        onPageChange={setPage}
      />
    </>
  );
}
