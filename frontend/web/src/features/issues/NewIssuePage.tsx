import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listSales } from '@/api/sales.api';
import { createIssue } from '@/api/issues.api';
import { queryKeys } from '@/api/queryClient';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { FormField, Select, TextArea, TextInput } from '@/components/ui/FormField';
import { useToast } from '@/components/ui/toast';
import { toDateInputValue } from '@/lib/dates';
import { toUserMessage } from '@/lib/errors';

const issueSchema = z.object({
  salesId: z.string().min(1, 'Select a sale'),
  description: z.string().trim().min(10, 'Describe the issue (min 10 characters)'),
  dateRaised: z.string().min(1, 'Date raised is required'),
  status: z.enum(['in_assistance', 'rejected', 'completed']),
});

type IssueFormValues = z.input<typeof issueSchema>;

export function NewIssuePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();

  const sales = useQuery({
    queryKey: [...queryKeys.sales, 'all'],
    queryFn: () => listSales({ pageSize: 100 }),
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<IssueFormValues>({
    resolver: zodResolver(issueSchema),
    defaultValues: {
      salesId: '',
      description: '',
      dateRaised: toDateInputValue(new Date()),
      status: 'in_assistance',
    },
  });

  const mutation = useMutation({
    mutationFn: (values: IssueFormValues) =>
      createIssue({
        salesId: values.salesId,
        description: values.description,
        dateRaised: new Date(values.dateRaised).toISOString(),
        status: values.status,
      }),
    onSuccess: (issue) => {
      toast.success('Issue created');
      void queryClient.invalidateQueries({ queryKey: queryKeys.issues });
      navigate(`/app/issues/${issue.id}`);
    },
    onError: (error) => toast.error(toUserMessage(error)),
  });

  return (
    <>
      <PageHeader title="Create issue" description="Raise a new customer issue against a sale." />

      <form
        onSubmit={handleSubmit((values) => mutation.mutate(values))}
        style={{ maxWidth: 640 }}
      >
        <Card>
          <CardHeader title="Issue details" />
          <CardBody className="stack">
            <FormField label="Sale" htmlFor="salesId" error={errors.salesId?.message}>
              <Select id="salesId" invalid={Boolean(errors.salesId)} {...register('salesId')}>
                <option value="">Select a sale…</option>
                {sales.data?.items.map((sale) => (
                  <option key={sale.id} value={sale.id}>
                    {sale.customer?.fullName ?? 'Customer'} · {new Date(sale.date).toLocaleDateString()}
                  </option>
                ))}
              </Select>
            </FormField>

            <FormField label="Description" htmlFor="description" error={errors.description?.message}>
              <TextArea
                id="description"
                rows={5}
                placeholder="Describe the customer issue…"
                invalid={Boolean(errors.description)}
                {...register('description')}
              />
            </FormField>

            <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
              <FormField label="Date raised" htmlFor="dateRaised" error={errors.dateRaised?.message}>
                <TextInput id="dateRaised" type="date" invalid={Boolean(errors.dateRaised)} {...register('dateRaised')} />
              </FormField>
              <FormField label="Initial status" htmlFor="status">
                <Select id="status" {...register('status')}>
                  <option value="in_assistance">In assistance</option>
                  <option value="rejected">Rejected</option>
                  <option value="completed">Completed</option>
                </Select>
              </FormField>
            </div>

            <div className="row" style={{ justifyContent: 'flex-end', gap: 10 }}>
              <Button variant="ghost" onClick={() => navigate('/app/issues')}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={mutation.isPending}>
                <Icon name="check" size={16} /> Create issue
              </Button>
            </div>
          </CardBody>
        </Card>
      </form>
    </>
  );
}
