import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { listSops } from '@/api/sops.api';
import { queryKeys } from '@/api/queryClient';
import type { SopDto } from '@/api/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { PermissionGate } from '@/components/layout/PermissionGate';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { DataTable, type Column } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { ActiveBadge } from '@/components/ui/StatusBadge';
import { SearchInput } from '@/components/ui/SearchInput';
import { TableSkeleton, EmptyState, ErrorState } from '@/components/ui/states';
import { formatRelative } from '@/lib/dates';
import { toUserMessage } from '@/lib/errors';

export function SopsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');

  const query = useQuery({
    queryKey: [...queryKeys.sops, { search }],
    queryFn: () => listSops({ search: search || undefined }),
  });

  const columns: ReadonlyArray<Column<SopDto>> = [
    {
      key: 'name',
      header: 'SOP',
      render: (sop) => (
        <div className="stack" style={{ gap: 1 }}>
          <span style={{ fontWeight: 600 }}>{sop.name}</span>
          <span className="subtle text-sm truncate" style={{ maxWidth: 360 }}>
            {sop.description}
          </span>
        </div>
      ),
    },
    {
      key: 'version',
      header: 'Latest version',
      align: 'right',
      render: (sop) => <Badge tone="brand">v{sop.latestVersion ?? sop.details?.length ?? 1}</Badge>,
    },
    { key: 'updated', header: 'Updated', render: (sop) => formatRelative(sop.updatedAt), width: 140 },
    { key: 'active', header: 'Status', render: (sop) => <ActiveBadge active={sop.active} /> },
  ];

  return (
    <>
      <PageHeader
        title="Standard Operating Procedures"
        description="Versioned operating procedures for the team."
        actions={
          <PermissionGate anyOf={['write-sop']}>
            <Link to="/app/sops/new" className="btn btn-primary">
              <Icon name="plus" size={16} /> Create SOP
            </Link>
          </PermissionGate>
        }
      />

      <div className="toolbar">
        <SearchInput value={search} onChange={setSearch} placeholder="Search SOPs…" />
      </div>

      <Card>
        {query.isLoading ? (
          <TableSkeleton columns={4} />
        ) : query.isError ? (
          <ErrorState description={toUserMessage(query.error)} onRetry={() => query.refetch()} />
        ) : (query.data?.items.length ?? 0) === 0 ? (
          <EmptyState icon="sop" title="No SOPs found" />
        ) : (
          <DataTable
            columns={columns}
            rows={query.data?.items ?? []}
            rowKey={(sop) => sop.id}
            onRowClick={(sop) => navigate(`/app/sops/${sop.id}`)}
          />
        )}
      </Card>
    </>
  );
}
