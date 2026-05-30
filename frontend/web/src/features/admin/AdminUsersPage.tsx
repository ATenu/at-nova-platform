import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listUsers, syncUserToKeycloak } from '@/api/admin.api';
import { queryKeys } from '@/api/queryClient';
import type { AdminUserDto, KeycloakSyncStatus } from '@/api/types';
import { NOVA_ROLES, roleLabel } from '@/auth/permissions';
import { useAuth } from '@/auth/AuthProvider';
import { PageHeader } from '@/components/layout/PageHeader';
import { PermissionGate } from '@/components/layout/PermissionGate';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Avatar } from '@/components/ui/Avatar';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { DataTable, type Column } from '@/components/ui/Table';
import { Select } from '@/components/ui/FormField';
import { SearchInput } from '@/components/ui/SearchInput';
import { Pagination } from '@/components/ui/Pagination';
import { TableSkeleton, EmptyState, ErrorState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { toUserMessage } from '@/lib/errors';
import { UserFormModal } from './UserFormModal';
import { RoleAssignmentModal } from './RoleAssignmentModal';

const SYNC_TONE: Record<KeycloakSyncStatus, BadgeTone> = {
  synced: 'success',
  partial: 'warning',
  not_found: 'neutral',
  error: 'danger',
};

const SYNC_LABEL: Record<KeycloakSyncStatus, string> = {
  synced: 'Synced',
  partial: 'Partial',
  not_found: 'Not in Keycloak',
  error: 'Sync error',
};

export function AdminUsersPage() {
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canWrite = can('write-users');

  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [rolesUser, setRolesUser] = useState<AdminUserDto | null>(null);

  const query = useQuery({
    queryKey: [...queryKeys.users, { search, role, page }],
    queryFn: () => listUsers({ search: search || undefined, role: role || undefined, page }),
  });

  const syncMutation = useMutation({
    mutationFn: (id: string) => syncUserToKeycloak(id),
    onSuccess: (user) => {
      toast.success(`Keycloak ${user.keycloak.syncStatus}`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.users });
    },
    onError: (error) => toast.error(toUserMessage(error)),
  });

  const columns: ReadonlyArray<Column<AdminUserDto>> = [
    {
      key: 'user',
      header: 'User',
      render: (user) => (
        <div className="row">
          <Avatar name={`${user.firstName} ${user.lastName}`} size="sm" />
          <div className="stack" style={{ gap: 0 }}>
            <span style={{ fontWeight: 600 }}>
              {user.firstName} {user.lastName}
            </span>
            <span className="subtle text-sm">{user.email}</span>
          </div>
        </div>
      ),
    },
    {
      key: 'roles',
      header: 'Roles',
      render: (user) => (
        <div className="row wrap" style={{ gap: 6 }}>
          {user.roles.map((r) => (
            <Badge key={r} tone="brand">
              {roleLabel(r)}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      key: 'keycloak',
      header: 'Keycloak',
      render: (user) => (
        <Badge tone={SYNC_TONE[user.keycloak.syncStatus]} dot>
          {SYNC_LABEL[user.keycloak.syncStatus]}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (user) =>
        canWrite ? (
          <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
            <Button size="sm" onClick={() => setRolesUser(user)}>
              <Icon name="shield" size={14} /> Roles
            </Button>
            <Button
              size="sm"
              variant="ghost"
              loading={syncMutation.isPending && syncMutation.variables === user.id}
              onClick={() => syncMutation.mutate(user.id)}
            >
              <Icon name="refresh" size={14} /> Sync
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="Users"
        description="Manage application users and their Keycloak provisioning."
        actions={
          <PermissionGate anyOf={['write-users']}>
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              <Icon name="plus" size={16} /> Create user
            </Button>
          </PermissionGate>
        }
      />

      <div className="toolbar">
        <SearchInput value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search by name or email…" />
        <Select value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} style={{ maxWidth: 220 }}>
          <option value="">All roles</option>
          {NOVA_ROLES.map((r) => (
            <option key={r} value={r}>
              {roleLabel(r)}
            </option>
          ))}
        </Select>
      </div>

      <Card>
        {query.isLoading ? (
          <TableSkeleton columns={4} />
        ) : query.isError ? (
          <ErrorState description={toUserMessage(query.error)} onRetry={() => query.refetch()} />
        ) : (query.data?.items.length ?? 0) === 0 ? (
          <EmptyState icon="users" title="No users found" />
        ) : (
          <DataTable columns={columns} rows={query.data?.items ?? []} rowKey={(user) => user.id} />
        )}
      </Card>

      <Pagination page={query.data?.page ?? 1} totalPages={query.data?.totalPages ?? 1} onPageChange={setPage} />

      <UserFormModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <RoleAssignmentModal user={rolesUser} onClose={() => setRolesUser(null)} />
    </>
  );
}
