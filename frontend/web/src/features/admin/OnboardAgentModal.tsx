import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { onboardAgent } from '@/api/agents.api';
import type { OnboardAgentRequest } from '@/api/types';
import { queryKeys } from '@/api/queryClient';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { FormField, TextInput, TextArea } from '@/components/ui/FormField';
import { useToast } from '@/components/ui/toast';
import { toUserMessage } from '@/lib/errors';

const AGENT_NAME = /^[a-z][a-z0-9-]{1,98}[a-z0-9]$/;

const onboardSchema = z.object({
  hostUrl: z
    .string()
    .trim()
    .url('Enter a valid URL')
    .refine((value) => /^https?:\/\//i.test(value), 'Must be an http(s) URL'),
  audience: z.string().trim().min(1, 'Audience is required').max(255),
  name: z
    .string()
    .trim()
    .regex(AGENT_NAME, 'Lowercase letters, digits and dashes')
    .optional()
    .or(z.literal('')),
  displayName: z.string().trim().max(255).optional(),
  description: z.string().trim().max(2000).optional(),
  tags: z.string().trim().optional(),
  enabled: z.boolean().optional(),
});

type OnboardForm = z.input<typeof onboardSchema>;

function parseTags(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
    .slice(0, 20);
}

export function OnboardAgentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<OnboardForm>({
    resolver: zodResolver(onboardSchema),
    defaultValues: {
      hostUrl: '',
      audience: '',
      name: '',
      displayName: '',
      description: '',
      tags: '',
      enabled: true,
    },
  });

  const mutation = useMutation({
    mutationFn: (values: OnboardForm) => {
      const tags = parseTags(values.tags);
      const body: OnboardAgentRequest = {
        hostUrl: values.hostUrl,
        audience: values.audience,
        ...(values.name ? { name: values.name } : {}),
        ...(values.displayName ? { displayName: values.displayName } : {}),
        ...(values.description ? { description: values.description } : {}),
        ...(tags.length > 0 ? { tags } : {}),
        enabled: values.enabled ?? true,
      };
      return onboardAgent(body);
    },
    onSuccess: (agent) => {
      toast.success(`Onboarded ${agent.displayName ?? agent.name}`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents });
      handleClose();
    },
    onError: (error) => toast.error(toUserMessage(error)),
  });

  const handleClose = () => {
    reset();
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Onboard agent"
      footer={
        <>
          <Button variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={mutation.isPending}
            onClick={handleSubmit((values) => mutation.mutate(values))}
          >
            Onboard agent
          </Button>
        </>
      }
    >
      <form className="stack" onSubmit={handleSubmit((values) => mutation.mutate(values))}>
        <p className="muted text-sm" style={{ margin: 0 }}>
          The platform fetches the Agent Card from the host over native A2A — skills and capabilities
          are never hand-entered. The agent must also have its token audience provisioned in Keycloak
          to be callable.
        </p>
        <FormField label="Host URL" htmlFor="hostUrl" error={errors.hostUrl?.message}>
          <TextInput
            id="hostUrl"
            placeholder="https://my-agent.internal:8443"
            invalid={Boolean(errors.hostUrl)}
            {...register('hostUrl')}
          />
        </FormField>
        <FormField label="Token audience" htmlFor="audience" error={errors.audience?.message}>
          <TextInput
            id="audience"
            placeholder="nova-agent-usecase-x"
            invalid={Boolean(errors.audience)}
            {...register('audience')}
          />
        </FormField>
        <FormField
          label="Name (optional, defaults to card name)"
          htmlFor="name"
          error={errors.name?.message}
        >
          <TextInput id="name" placeholder="at-usecase-x" invalid={Boolean(errors.name)} {...register('name')} />
        </FormField>
        <FormField label="Display name (optional)" htmlFor="displayName">
          <TextInput id="displayName" {...register('displayName')} />
        </FormField>
        <FormField label="Description (optional)" htmlFor="description">
          <TextArea id="description" rows={2} {...register('description')} />
        </FormField>
        <FormField label="Tags (optional, comma-separated)" htmlFor="tags">
          <TextInput id="tags" placeholder="finance, reporting" {...register('tags')} />
        </FormField>
        <label className="checkbox">
          <input type="checkbox" {...register('enabled')} />
          Enable for routing immediately
        </label>
      </form>
    </Modal>
  );
}
