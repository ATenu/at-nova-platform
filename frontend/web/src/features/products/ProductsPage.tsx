import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listProducts } from '@/api/products.api';
import { queryKeys } from '@/api/queryClient';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { SearchInput } from '@/components/ui/SearchInput';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { formatMoney } from '@/lib/money';
import { toUserMessage } from '@/lib/errors';

export function ProductsPage() {
  const [search, setSearch] = useState('');
  const query = useQuery({
    queryKey: [...queryKeys.products, { search }],
    queryFn: () => listProducts({ search: search || undefined }),
  });

  const products = query.data?.items ?? [];

  return (
    <>
      <PageHeader title="Products" description="The Nova product catalogue." />

      <div className="toolbar">
        <SearchInput value={search} onChange={setSearch} placeholder="Search products…" />
      </div>

      {query.isLoading ? (
        <Card>
          <LoadingState />
        </Card>
      ) : query.isError ? (
        <Card>
          <ErrorState description={toUserMessage(query.error)} onRetry={() => query.refetch()} />
        </Card>
      ) : products.length === 0 ? (
        <Card>
          <EmptyState icon="product" title="No products found" />
        </Card>
      ) : (
        <div className="grid grid-cards">
          {products.map((product) => (
            <Card key={product.id}>
              <CardBody>
                <div className="row-between" style={{ alignItems: 'flex-start' }}>
                  <h3 style={{ fontSize: 16 }}>{product.name}</h3>
                  <Badge tone={product.inCatalog ? 'success' : 'neutral'} dot>
                    {product.inCatalog ? 'In catalog' : 'Hidden'}
                  </Badge>
                </div>
                <p className="muted text-sm" style={{ marginTop: 8, minHeight: 40 }}>
                  {product.description}
                </p>
                <div className="row-between" style={{ marginTop: 12 }}>
                  <Badge tone="brand">{product.category}</Badge>
                  <span style={{ fontWeight: 700, fontSize: 17 }}>{formatMoney(product.price)}</span>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
