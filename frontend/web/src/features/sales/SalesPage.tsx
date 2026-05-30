import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { listSales } from '@/api/sales.api';
import { queryKeys } from '@/api/queryClient';
import type { SaleDto } from '@/api/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { PermissionGate } from '@/components/layout/PermissionGate';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { DataTable, type Column } from '@/components/ui/Table';
import { Select } from '@/components/ui/FormField';
import { PaymentBadge } from '@/components/ui/StatusBadge';
import { Badge } from '@/components/ui/Badge';
import { Pagination } from '@/components/ui/Pagination';
import { TableSkeleton, EmptyState, ErrorState } from '@/components/ui/states';
import { formatDate } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { toUserMessage } from '@/lib/errors';

type PaymentFilter = 'all' | 'paid' | 'unpaid';

function productsSummary(sale: SaleDto): string {
  const items = sale.productsSold ?? [];
  if (items.length === 0) return '—';
  return items
    .map((item) => `${item.product?.name ?? 'Item'} ×${item.quantity}`)
    .join(', ');
}

export function SalesPage() {
  const navigate = useNavigate();
  const [payment, setPayment] = useState<PaymentFilter>('all');
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: [...queryKeys.sales, { payment, page }],
    queryFn: () =>
      listSales({
        page,
        ...(payment === 'all' ? {} : { paymentReceived: payment === 'paid' }),
      }),
  });

  const columns: ReadonlyArray<Column<SaleDto>> = [
    { key: 'date', header: 'Date', render: (sale) => formatDate(sale.date), width: 130 },
    {
      key: 'customer',
      header: 'Customer',
      render: (sale) => sale.customer?.fullName ?? '—',
    },
    {
      key: 'products',
      header: 'Products',
      render: (sale) => <span className="truncate" style={{ maxWidth: 240, display: 'inline-block' }}>{productsSummary(sale)}</span>,
    },
    {
      key: 'discount',
      header: 'Discount',
      align: 'right',
      render: (sale) => (sale.discountApplied ? `${Number(sale.discountApplied)}%` : '—'),
    },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      render: (sale) => <strong>{formatMoney(sale.totalAmountReceipt)}</strong>,
    },
    { key: 'payment', header: 'Payment', render: (sale) => <PaymentBadge paid={sale.paymentReceived} /> },
    {
      key: 'issues',
      header: 'Issues',
      align: 'right',
      render: (sale) =>
        sale.issuesCount && sale.issuesCount > 0 ? (
          <Badge tone="warning">{sale.issuesCount}</Badge>
        ) : (
          <span className="subtle">0</span>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Sales"
        description="Registered sales, payment status, and linked issues."
        actions={
          <PermissionGate anyOf={['write-sales']}>
            <Link to="/app/sales/new" className="btn btn-primary">
              <Icon name="plus" size={16} /> Register sale
            </Link>
          </PermissionGate>
        }
      />

      <div className="toolbar">
        <Select
          value={payment}
          onChange={(e) => {
            setPayment(e.target.value as PaymentFilter);
            setPage(1);
          }}
          style={{ maxWidth: 200 }}
        >
          <option value="all">All payments</option>
          <option value="paid">Paid</option>
          <option value="unpaid">Unpaid</option>
        </Select>
      </div>

      <Card>
        {query.isLoading ? (
          <TableSkeleton columns={7} />
        ) : query.isError ? (
          <ErrorState description={toUserMessage(query.error)} onRetry={() => query.refetch()} />
        ) : (query.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            icon="sales"
            title="No sales yet"
            action={
              <PermissionGate anyOf={['write-sales']}>
                <Button variant="primary" onClick={() => navigate('/app/sales/new')}>
                  <Icon name="plus" size={16} /> Register the first sale
                </Button>
              </PermissionGate>
            }
          />
        ) : (
          <DataTable
            columns={columns}
            rows={query.data?.items ?? []}
            rowKey={(sale) => sale.id}
            onRowClick={(sale) => navigate(`/app/sales/${sale.id}`)}
          />
        )}
      </Card>

      <Pagination page={query.data?.page ?? 1} totalPages={query.data?.totalPages ?? 1} onPageChange={setPage} />
    </>
  );
}
