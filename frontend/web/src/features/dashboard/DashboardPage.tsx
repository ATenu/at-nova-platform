import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { roleLabel } from '@/auth/permissions';
import { queryKeys } from '@/api/queryClient';
import { listCustomers } from '@/api/customers.api';
import { listSales } from '@/api/sales.api';
import { listIssues } from '@/api/issues.api';
import { listActions } from '@/api/actions.api';
import { listSops } from '@/api/sops.api';
import { listUsers, getRolePermissionMatrix } from '@/api/admin.api';
import { listConversations } from '@/api/chat.api';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatCard } from '@/components/ui/StatCard';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { EmptyState } from '@/components/ui/states';
import { IssueStatusBadge } from '@/components/ui/StatusBadge';
import { formatRelative } from '@/lib/dates';

export function DashboardPage() {
  const { user, can } = useAuth();
  const firstName = user?.firstName ?? 'there';

  const customers = useQuery({
    queryKey: queryKeys.customers,
    queryFn: () => listCustomers({ pageSize: 1 }),
    enabled: can('read-customers'),
  });
  const sales = useQuery({
    queryKey: queryKeys.sales,
    queryFn: () => listSales({ pageSize: 5 }),
    enabled: can('read-sales'),
  });
  const unpaidSales = useQuery({
    queryKey: [...queryKeys.sales, 'unpaid'],
    queryFn: () => listSales({ paymentReceived: false, pageSize: 1 }),
    enabled: can('read-sales'),
  });
  const issues = useQuery({
    queryKey: queryKeys.issues,
    queryFn: () => listIssues({ pageSize: 5 }),
    enabled: can('read-issues'),
  });
  const actions = useQuery({
    queryKey: queryKeys.actions,
    queryFn: () => listActions({ pageSize: 100 }),
    enabled: can('read-actions'),
  });
  const sops = useQuery({
    queryKey: queryKeys.sops,
    queryFn: () => listSops({ pageSize: 100 }),
    enabled: can('read-sop'),
  });
  const users = useQuery({
    queryKey: queryKeys.users,
    queryFn: () => listUsers({ pageSize: 1 }),
    enabled: can('read-users'),
  });
  const matrix = useQuery({
    queryKey: ['admin', 'role-permissions'],
    queryFn: getRolePermissionMatrix,
    enabled: can('read-permissions'),
  });
  const conversations = useQuery({
    queryKey: queryKeys.conversations,
    queryFn: listConversations,
  });

  const openIssues =
    issues.data?.items.filter((issue) => issue.status === 'in_assistance').length ?? 0;
  const pendingActions =
    actions.data?.items.filter((action) => action.status === 'pending').length ?? 0;
  const inProgressActions =
    actions.data?.items.filter((action) => action.status === 'in_progress').length ?? 0;
  const activeSops = sops.data?.items.filter((sop) => sop.active).length ?? 0;

  return (
    <>
      <PageHeader
        title={`Welcome back, ${firstName}`}
        description={
          user ? `Signed in as ${user.roles.map(roleLabel).join(', ') || 'user'}.` : undefined
        }
      />

      <div className="grid grid-cards" style={{ marginBottom: 20 }}>
        {can('read-users') ? (
          <StatCard label="Users" value={users.data?.total ?? '—'} icon="users" loading={users.isLoading} />
        ) : null}
        {can('read-permissions') ? (
          <StatCard
            label="Permission grants"
            value={matrix.data?.totalGrants ?? '—'}
            icon="shield"
            loading={matrix.isLoading}
          />
        ) : null}
        {can('read-customers') ? (
          <StatCard
            label="Customers"
            value={customers.data?.total ?? '—'}
            icon="customers"
            loading={customers.isLoading}
          />
        ) : null}
        {can('read-sales') ? (
          <StatCard label="Sales" value={sales.data?.total ?? '—'} icon="sales" loading={sales.isLoading} />
        ) : null}
        {can('read-sales') ? (
          <StatCard
            label="Unpaid sales"
            value={unpaidSales.data?.total ?? '—'}
            icon="alert"
            loading={unpaidSales.isLoading}
          />
        ) : null}
        {can('read-issues') ? (
          <StatCard label="Open issues" value={openIssues} icon="issues" loading={issues.isLoading} />
        ) : null}
        {can('read-actions') ? (
          <StatCard
            label="Pending actions"
            value={pendingActions}
            icon="actions"
            hint={`${inProgressActions} in progress`}
            loading={actions.isLoading}
          />
        ) : null}
        {can('read-sop') ? (
          <StatCard label="Active SOPs" value={activeSops} icon="sop" loading={sops.isLoading} />
        ) : null}
      </div>

      <div className="detail-grid">
        <div className="stack">
          {can('read-issues') ? (
            <Card>
              <CardHeader
                title="Recent issues"
                actions={
                  <Link to="/app/issues" className="btn btn-sm">
                    View all
                  </Link>
                }
              />
              <CardBody>
                {(issues.data?.items.length ?? 0) === 0 ? (
                  <EmptyState icon="issues" title="No issues yet" />
                ) : (
                  <div className="stack" style={{ gap: 10 }}>
                    {issues.data?.items.slice(0, 5).map((issue) => (
                      <Link
                        key={issue.id}
                        to={`/app/issues/${issue.id}`}
                        className="row-between"
                        style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 12 }}
                      >
                        <span className="grow truncate">{issue.description}</span>
                        <IssueStatusBadge status={issue.status} />
                      </Link>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>
          ) : null}

          {can('read-sales') ? (
            <Card>
              <CardHeader
                title="Recent sales"
                actions={
                  <Link to="/app/sales" className="btn btn-sm">
                    View all
                  </Link>
                }
              />
              <CardBody>
                {(sales.data?.items.length ?? 0) === 0 ? (
                  <EmptyState icon="sales" title="No sales yet" />
                ) : (
                  <div className="stack" style={{ gap: 10 }}>
                    {sales.data?.items.slice(0, 5).map((sale) => (
                      <Link
                        key={sale.id}
                        to={`/app/sales/${sale.id}`}
                        className="row-between"
                        style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 12 }}
                      >
                        <span className="grow truncate">
                          {sale.customer?.fullName ?? 'Customer'} · {formatRelative(sale.date)}
                        </span>
                        <Badge tone={sale.paymentReceived ? 'success' : 'warning'} dot>
                          {sale.paymentReceived ? 'Paid' : 'Unpaid'}
                        </Badge>
                      </Link>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>
          ) : null}
        </div>

        <div className="stack">
          <Card>
            <CardHeader title="Quick actions" />
            <CardBody>
              <div className="stack" style={{ gap: 8 }}>
                <Link to="/app/chat" className="btn btn-block">
                  <Icon name="chat" size={16} /> Ask the Nova agent
                </Link>
                {can('write-sales') ? (
                  <Link to="/app/sales/new" className="btn btn-block">
                    <Icon name="plus" size={16} /> Register a sale
                  </Link>
                ) : null}
                {can('create-issues') ? (
                  <Link to="/app/issues/new" className="btn btn-block">
                    <Icon name="plus" size={16} /> Create an issue
                  </Link>
                ) : null}
                {can('write-sop') ? (
                  <Link to="/app/sops/new" className="btn btn-block">
                    <Icon name="plus" size={16} /> Create an SOP
                  </Link>
                ) : null}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Recent conversations"
              actions={
                <Link to="/app/chat" className="btn btn-sm">
                  Open chat
                </Link>
              }
            />
            <CardBody>
              {(conversations.data?.length ?? 0) === 0 ? (
                <EmptyState icon="chat" title="No conversations yet" />
              ) : (
                <div className="stack" style={{ gap: 8 }}>
                  {conversations.data?.slice(0, 4).map((conversation) => (
                    <Link
                      key={conversation.id}
                      to={`/app/chat?c=${conversation.id}`}
                      className="row"
                      style={{ padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 10 }}
                    >
                      <Icon name="chat" size={15} />
                      <span className="grow truncate text-sm">
                        {conversation.title ?? `Conversation ${conversation.id.slice(0, 6)}`}
                      </span>
                      <span className="subtle" style={{ fontSize: 11 }}>
                        {formatRelative(conversation.createdDate)}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
