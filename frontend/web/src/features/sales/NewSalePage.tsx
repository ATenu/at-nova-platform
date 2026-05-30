import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listCustomers } from '@/api/customers.api';
import { listProducts } from '@/api/products.api';
import { createSale } from '@/api/sales.api';
import { queryKeys } from '@/api/queryClient';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { FormField, Select, TextInput } from '@/components/ui/FormField';
import { useToast } from '@/components/ui/toast';
import { computeSaleTotals, formatMoney, parseMoney, toMoneyString } from '@/lib/money';
import { toDateInputValue } from '@/lib/dates';
import { toUserMessage } from '@/lib/errors';

const saleSchema = z
  .object({
    customerId: z.string().min(1, 'Select a customer'),
    date: z.string().min(1, 'Sale date is required'),
    discountApplied: z.number({ message: 'Enter a number' }).min(0, 'Min 0%').max(100, 'Max 100%'),
    paymentReceived: z.boolean(),
    dateOfPayment: z.string().optional(),
    items: z
      .array(
        z.object({
          productId: z.string().min(1, 'Select a product'),
          quantity: z.number({ message: 'Enter a quantity' }).int().positive('Qty must be > 0'),
        }),
      )
      .min(1, 'Add at least one item'),
  })
  .refine((data) => !data.paymentReceived || Boolean(data.dateOfPayment), {
    message: 'Payment date is required when payment is received',
    path: ['dateOfPayment'],
  })
  .refine((data) => data.paymentReceived || !data.dateOfPayment, {
    message: 'Payment date must be empty when payment is not received',
    path: ['dateOfPayment'],
  });

type SaleFormValues = z.input<typeof saleSchema>;

export function NewSalePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();

  const customers = useQuery({
    queryKey: [...queryKeys.customers, 'all'],
    queryFn: () => listCustomers({ pageSize: 100 }),
  });
  const products = useQuery({
    queryKey: [...queryKeys.products, 'all'],
    queryFn: () => listProducts({ pageSize: 100 }),
  });

  const {
    register,
    control,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<SaleFormValues>({
    resolver: zodResolver(saleSchema),
    defaultValues: {
      customerId: '',
      date: toDateInputValue(new Date()),
      discountApplied: 0,
      paymentReceived: false,
      dateOfPayment: '',
      items: [{ productId: '', quantity: 1 }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'items' });
  const watchedItems = watch('items');
  const discount = Number(watch('discountApplied')) || 0;
  const paymentReceived = watch('paymentReceived');

  const priceFor = useMemo(() => {
    const map = new Map((products.data?.items ?? []).map((product) => [product.id, product.price]));
    return (productId: string) => map.get(productId) ?? '0';
  }, [products.data]);

  const totals = useMemo(
    () =>
      computeSaleTotals(
        (watchedItems ?? []).map((item) => ({
          unitPrice: priceFor(item.productId),
          quantity: Number(item.quantity) || 0,
        })),
        discount,
      ),
    [watchedItems, discount, priceFor],
  );

  const mutation = useMutation({
    mutationFn: (values: SaleFormValues) =>
      createSale({
        customerId: values.customerId,
        date: new Date(values.date).toISOString(),
        discountApplied: toMoneyString(Number(values.discountApplied) || 0),
        paymentReceived: values.paymentReceived,
        dateOfPayment:
          values.paymentReceived && values.dateOfPayment
            ? new Date(values.dateOfPayment).toISOString()
            : null,
        items: values.items.map((item) => ({
          productId: item.productId,
          quantity: Number(item.quantity),
        })),
        totalAmountReceipt: toMoneyString(totals.total),
      }),
    onSuccess: () => {
      toast.success('Sale registered');
      void queryClient.invalidateQueries({ queryKey: queryKeys.sales });
      navigate('/app/sales');
    },
    onError: (error) => toast.error(toUserMessage(error)),
  });

  return (
    <>
      <PageHeader title="Register sale" description="Create a new sale and calculate the receipt." />

      <form onSubmit={handleSubmit((values) => mutation.mutate(values))} className="detail-grid">
        <div className="stack">
          <Card>
            <CardHeader title="Sale details" />
            <CardBody className="stack">
              <FormField label="Customer" htmlFor="customerId" error={errors.customerId?.message}>
                <Select id="customerId" invalid={Boolean(errors.customerId)} {...register('customerId')}>
                  <option value="">Select a customer…</option>
                  {customers.data?.items.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.fullName} · {customer.email}
                    </option>
                  ))}
                </Select>
              </FormField>

              <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
                <FormField label="Sale date" htmlFor="date" error={errors.date?.message}>
                  <TextInput id="date" type="date" invalid={Boolean(errors.date)} {...register('date')} />
                </FormField>
                <FormField label="Discount %" htmlFor="discount" error={errors.discountApplied?.message}>
                  <TextInput
                    id="discount"
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    invalid={Boolean(errors.discountApplied)}
                    {...register('discountApplied', { valueAsNumber: true })}
                  />
                </FormField>
              </div>

              <label className="checkbox">
                <input type="checkbox" {...register('paymentReceived')} />
                Payment received
              </label>

              {paymentReceived ? (
                <FormField label="Payment date" htmlFor="dateOfPayment" error={errors.dateOfPayment?.message}>
                  <TextInput
                    id="dateOfPayment"
                    type="date"
                    invalid={Boolean(errors.dateOfPayment)}
                    {...register('dateOfPayment')}
                  />
                </FormField>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Items"
              actions={
                <Button size="sm" onClick={() => append({ productId: '', quantity: 1 })}>
                  <Icon name="plus" size={15} /> Add item
                </Button>
              }
            />
            <CardBody className="stack">
              {typeof errors.items?.message === 'string' ? (
                <span className="field-error">{errors.items.message}</span>
              ) : null}
              {fields.map((field, index) => {
                const item = watchedItems?.[index];
                const unitPrice = item ? priceFor(item.productId) : '0';
                const lineTotal = parseMoney(unitPrice) * (Number(item?.quantity) || 0);
                return (
                  <div key={field.id} className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                    <div className="grow">
                      <Controller
                        control={control}
                        name={`items.${index}.productId`}
                        render={({ field: f }) => (
                          <Select invalid={Boolean(errors.items?.[index]?.productId)} {...f}>
                            <option value="">Select product…</option>
                            {products.data?.items.map((product) => (
                              <option key={product.id} value={product.id}>
                                {product.name} — {formatMoney(product.price)}
                              </option>
                            ))}
                          </Select>
                        )}
                      />
                    </div>
                    <TextInput
                      type="number"
                      min={1}
                      style={{ width: 90 }}
                      aria-label="Quantity"
                      invalid={Boolean(errors.items?.[index]?.quantity)}
                      {...register(`items.${index}.quantity`, { valueAsNumber: true })}
                    />
                    <div style={{ width: 96, textAlign: 'right', paddingTop: 10, fontWeight: 600 }}>
                      {formatMoney(lineTotal)}
                    </div>
                    <Button
                      variant="ghost"
                      className="btn-icon"
                      onClick={() => remove(index)}
                      disabled={fields.length <= 1}
                      aria-label="Remove item"
                    >
                      <Icon name="close" size={16} />
                    </Button>
                  </div>
                );
              })}
            </CardBody>
          </Card>
        </div>

        <div className="stack">
          <Card>
            <CardHeader title="Receipt" />
            <CardBody className="stack">
              <div className="row-between">
                <span className="muted">Subtotal</span>
                <span>{formatMoney(totals.subtotal)}</span>
              </div>
              <div className="row-between">
                <span className="muted">Discount ({discount}%)</span>
                <span style={{ color: 'var(--danger)' }}>−{formatMoney(totals.discount)}</span>
              </div>
              <div className="row-between" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                <span style={{ fontWeight: 700 }}>Total</span>
                <span style={{ fontWeight: 760, fontSize: 20 }}>{formatMoney(totals.total)}</span>
              </div>
              <Button type="submit" variant="primary" block loading={mutation.isPending}>
                <Icon name="check" size={16} /> Register sale
              </Button>
              <Button variant="ghost" block onClick={() => navigate('/app/sales')}>
                Cancel
              </Button>
            </CardBody>
          </Card>
        </div>
      </form>
    </>
  );
}
