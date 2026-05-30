import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getSale } from '@/api/sales.api';
import { queryKeys } from '@/api/queryClient';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { PaymentBadge } from '@/components/ui/StatusBadge';
import { DataTable, type Column } from '@/components/ui/Table';
import { ErrorState, LoadingState } from '@/components/ui/states';
import type { ProductSoldDto } from '@/api/types';
import { formatDate } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { toUserMessage } from '@/lib/errors';

const itemColumns: ReadonlyArray<Column<ProductSoldDto>> = [
  { key: 'product', header: 'Product', render: (item) => item.product?.name ?? item.productId },
  { key: 'price', header: 'Unit price', align: 'right', render: (item) => formatMoney(item.product?.price ?? '0') },
  { key: 'qty', header: 'Qty', align: 'right', render: (item) => item.quantity },
  {
    key: 'total',
    header: 'Line total',
    align: 'right',
    render: (item) => formatMoney(Number(item.product?.price ?? 0) * item.quantity),
  },
];

export function SaleDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const query = useQuery({ queryKey: queryKeys.sale(id), queryFn: () => getSale(id), enabled: Boolean(id) });

  if (query.isLoading) return <LoadingState label="Loading sale…" />;
  if (query.isError || !query.data) {
    return <ErrorState description={toUserMessage(query.error)} onRetry={() => query.refetch()} />;
  }

  const sale = query.data;

  return (
    <>
      <PageHeader
        title={`Sale · ${sale.customer?.fullName ?? 'Customer'}`}
        description={formatDate(sale.date)}
        actions={
          <Button variant="ghost" onClick={() => navigate('/app/sales')}>
            <Icon name="arrowLeft" size={16} /> Back
          </Button>
        }
      />

      <div className="detail-grid">
        <Card>
          <CardHeader title="Items" />
          <CardBody>
            <DataTable
              columns={itemColumns}
              rows={sale.productsSold ?? []}
              rowKey={(item) => item.productId}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Receipt" />
          <CardBody>
            <dl className="kv">
              <dt>Customer</dt>
              <dd>{sale.customer?.fullName ?? '—'}</dd>
              <dt>Date</dt>
              <dd>{formatDate(sale.date)}</dd>
              <dt>Discount</dt>
              <dd>{sale.discountApplied ? `${Number(sale.discountApplied)}%` : '—'}</dd>
              <dt>Payment</dt>
              <dd>
                <PaymentBadge paid={sale.paymentReceived} />
              </dd>
              <dt>Paid on</dt>
              <dd>{sale.dateOfPayment ? formatDate(sale.dateOfPayment) : '—'}</dd>
              <dt>Total</dt>
              <dd style={{ fontWeight: 760, fontSize: 18 }}>{formatMoney(sale.totalAmountReceipt)}</dd>
            </dl>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
