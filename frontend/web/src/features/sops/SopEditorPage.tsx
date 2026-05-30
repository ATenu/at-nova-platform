import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createSop, createSopVersion, getSop, updateSop } from '@/api/sops.api';
import { queryKeys } from '@/api/queryClient';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { FormField, TextArea, TextInput } from '@/components/ui/FormField';
import { LoadingState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { toUserMessage } from '@/lib/errors';

const sopSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  description: z.string().trim().min(1, 'Description is required'),
  active: z.boolean(),
  fullText: z.string().trim().min(1, 'Full text is required'),
});

type SopFormValues = z.input<typeof sopSchema>;

/**
 * Create a new SOP, or — when an id is present — create a new immutable detail
 * version for an existing SOP (history is never overwritten). Header fields
 * (name/description/active) are persisted via a separate update on edit.
 */
export function SopEditorPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();

  const existing = useQuery({
    queryKey: queryKeys.sop(id ?? 'new'),
    queryFn: () => getSop(id!),
    enabled: isEdit,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<SopFormValues>({
    resolver: zodResolver(sopSchema),
    defaultValues: { name: '', description: '', active: true, fullText: '' },
  });

  useEffect(() => {
    if (isEdit && existing.data) {
      const latest = [...(existing.data.details ?? [])].sort((a, b) => b.version - a.version)[0];
      reset({
        name: existing.data.name,
        description: existing.data.description,
        active: existing.data.active,
        fullText: latest?.fullText ?? '',
      });
    }
  }, [isEdit, existing.data, reset]);

  const mutation = useMutation({
    mutationFn: async (values: SopFormValues) => {
      if (isEdit && id) {
        await updateSop(id, {
          name: values.name,
          description: values.description,
          active: values.active,
        });
        await createSopVersion(id, { fullText: values.fullText });
        return id;
      }
      const created = await createSop({
        name: values.name,
        description: values.description,
        active: values.active,
        fullText: values.fullText,
      });
      return created.id;
    },
    onSuccess: (sopId) => {
      toast.success(isEdit ? 'New SOP version created' : 'SOP created');
      void queryClient.invalidateQueries({ queryKey: queryKeys.sops });
      void queryClient.invalidateQueries({ queryKey: queryKeys.sop(sopId) });
      navigate(`/app/sops/${sopId}`);
    },
    onError: (error) => toast.error(toUserMessage(error)),
  });

  if (isEdit && existing.isLoading) {
    return <LoadingState label="Loading SOP…" />;
  }

  return (
    <>
      <PageHeader
        title={isEdit ? 'New SOP version' : 'Create SOP'}
        description={
          isEdit
            ? 'Editing publishes a new version; previous versions are preserved.'
            : 'Define a new standard operating procedure.'
        }
      />

      <form onSubmit={handleSubmit((values) => mutation.mutate(values))} style={{ maxWidth: 760 }}>
        <Card>
          <CardHeader title="SOP details" />
          <CardBody className="stack">
            <FormField label="Name" htmlFor="name" error={errors.name?.message}>
              <TextInput id="name" invalid={Boolean(errors.name)} {...register('name')} />
            </FormField>
            <FormField label="Description" htmlFor="description" error={errors.description?.message}>
              <TextInput id="description" invalid={Boolean(errors.description)} {...register('description')} />
            </FormField>
            <FormField
              label="Full text"
              htmlFor="fullText"
              error={errors.fullText?.message}
              hint="This becomes the latest version's content."
            >
              <TextArea id="fullText" rows={12} invalid={Boolean(errors.fullText)} {...register('fullText')} />
            </FormField>
            <label className="checkbox">
              <input type="checkbox" {...register('active')} />
              Active
            </label>

            <div className="row" style={{ justifyContent: 'flex-end', gap: 10 }}>
              <Button variant="ghost" onClick={() => navigate(isEdit ? `/app/sops/${id}` : '/app/sops')}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={mutation.isPending}>
                <Icon name="check" size={16} /> {isEdit ? 'Publish new version' : 'Create SOP'}
              </Button>
            </div>
          </CardBody>
        </Card>
      </form>
    </>
  );
}
