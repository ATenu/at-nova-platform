import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createCapability, updateCapability } from '@/api/rbac.api';
import { queryKeys } from '@/api/queryClient';
import { permissionLabel } from '@/auth/permissions';
import type { CapabilityDto, PermissionDto } from '@/api/types';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { FormField, TextInput, TextArea, Select } from '@/components/ui/FormField';
import { useToast } from '@/components/ui/toast';
import { toUserMessage } from '@/lib/errors';

// Capability ids carry dots (e.g. `data.analyse.read`), matching the backend
// `rbacName` slug — so this is intentionally looser than role/permission names.
const CAPABILITY_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

const schema = z.object({
  id: z.string().trim().min(1, 'Id is required').max(100).regex(CAPABILITY_ID, 'Letters, digits, dot, hyphen or underscore'),
  kind: z.enum(['agent-skill', 'mcp-tool']),
  mode: z.enum(['read', 'write']),
  risk: z.enum(['low', 'high']),
  resourceScoped: z.boolean(),
  delegated: z.boolean(),
  requiresApproval: z.boolean(),
  requiredPermissions: z.array(z.string()).min(1, 'Select at least one permission'),
  description: z.string().trim().max(2000).optional(),
});

type CapabilityForm = z.infer<typeof schema>;

const EMPTY: CapabilityForm = {
  id: '',
  kind: 'agent-skill',
  mode: 'read',
  risk: 'low',
  resourceScoped: false,
  delegated: false,
  requiresApproval: false,
  requiredPermissions: [],
  description: '',
};

function toForm(capability: CapabilityDto): CapabilityForm {
  return {
    id: capability.id,
    kind: capability.kind,
    mode: capability.mode,
    risk: capability.risk,
    resourceScoped: capability.resourceScoped,
    delegated: capability.delegated,
    requiresApproval: capability.requiresApproval,
    requiredPermissions: [...capability.requiredPermissions],
    description: '',
  };
}

interface Props {
  readonly open: boolean;
  readonly onClose: () => void;
  /** When provided the modal edits an existing capability; otherwise it creates. */
  readonly capability?: CapabilityDto;
  readonly permissions: readonly PermissionDto[];
}

/**
 * Create or edit a capability and its required permissions. Capabilities are the
 * link between an agent's advertised skills (the capability id) and the RBAC
 * permissions a caller must hold; roles inherit usage by being granted those
 * permissions in the grant matrix. The backend remains the authorization
 * authority — this UI is advisory and fully audited server-side.
 */
export function CapabilityFormModal({ open, onClose, capability, permissions }: Props) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const isEdit = Boolean(capability);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CapabilityForm>({
    resolver: zodResolver(schema),
    defaultValues: capability ? toForm(capability) : EMPTY,
  });

  // Re-seed the form whenever the target capability (or open state) changes.
  useEffect(() => {
    if (open) reset(capability ? toForm(capability) : EMPTY);
  }, [open, capability, reset]);

  const afterMutation = async (message: string) => {
    toast.success(message);
    await queryClient.invalidateQueries({ queryKey: ['rbac', 'registry'] });
    await queryClient.invalidateQueries({ queryKey: queryKeys.me });
    handleClose();
  };

  const mutation = useMutation({
    mutationFn: (values: CapabilityForm) => {
      if (capability) {
        return updateCapability(capability.id, {
          risk: values.risk,
          requiresApproval: values.requiresApproval,
          requiredPermissions: values.requiredPermissions,
          description: values.description ? values.description : null,
        });
      }
      return createCapability({
        id: values.id,
        kind: values.kind,
        mode: values.mode,
        risk: values.risk,
        resourceScoped: values.resourceScoped,
        delegated: values.delegated,
        requiresApproval: values.requiresApproval,
        requiredPermissions: values.requiredPermissions,
        description: values.description ? values.description : null,
      });
    },
    onSuccess: () => afterMutation(isEdit ? 'Capability updated' : 'Capability created'),
    onError: (error) => toast.error(toUserMessage(error)),
  });

  const handleClose = () => {
    reset(EMPTY);
    onClose();
  };

  const submit = handleSubmit((values) => mutation.mutate(values));

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={isEdit ? `Edit capability` : 'New capability'}
      footer={
        <>
          <Button variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={mutation.isPending} onClick={submit}>
            {isEdit ? 'Save changes' : 'Create capability'}
          </Button>
        </>
      }
    >
      <form className="stack" onSubmit={submit}>
        <p className="muted text-sm" style={{ margin: 0 }}>
          The id must equal the skill id an agent advertises in its Agent Card (for example{' '}
          <code>data.analyse.read</code>). A caller may invoke the skill only if it holds every
          required permission below.
        </p>

        <FormField label="Capability id" htmlFor="cap-id" error={errors.id?.message}>
          <TextInput
            id="cap-id"
            placeholder="data.analyse.read"
            invalid={Boolean(errors.id)}
            disabled={isEdit}
            {...register('id')}
          />
        </FormField>

        <div className="row" style={{ gap: 12 }}>
          <FormField label="Kind" htmlFor="cap-kind">
            <Select id="cap-kind" disabled={isEdit} {...register('kind')}>
              <option value="agent-skill">agent-skill</option>
              <option value="mcp-tool">mcp-tool</option>
            </Select>
          </FormField>
          <FormField label="Mode" htmlFor="cap-mode">
            <Select id="cap-mode" disabled={isEdit} {...register('mode')}>
              <option value="read">read</option>
              <option value="write">write</option>
            </Select>
          </FormField>
          <FormField label="Risk" htmlFor="cap-risk">
            <Select id="cap-risk" {...register('risk')}>
              <option value="low">low</option>
              <option value="high">high</option>
            </Select>
          </FormField>
        </div>

        <FormField
          label="Required permissions"
          htmlFor="cap-perms"
          error={errors.requiredPermissions?.message}
        >
          <div
            id="cap-perms"
            className="stack"
            style={{
              gap: 4,
              maxHeight: 200,
              overflowY: 'auto',
              border: '1px solid var(--border-strong)',
              borderRadius: 8,
              padding: 10,
            }}
          >
            {permissions.length === 0 && <span className="muted text-sm">No permissions defined.</span>}
            {permissions.map((permission) => (
              <label key={permission.name} className="checkbox">
                <input type="checkbox" value={permission.name} {...register('requiredPermissions')} />
                {permissionLabel(permission.name)}
              </label>
            ))}
          </div>
        </FormField>

        <FormField label="Description (optional)" htmlFor="cap-description">
          <TextArea id="cap-description" rows={2} {...register('description')} />
        </FormField>

        <label className="checkbox">
          <input type="checkbox" {...register('requiresApproval')} />
          Require human approval before each use
        </label>
        <label className="checkbox">
          <input type="checkbox" disabled={isEdit} {...register('delegated')} />
          Delegated — invoked on behalf of a user (carries user entitlements)
        </label>
        <label className="checkbox">
          <input type="checkbox" disabled={isEdit} {...register('resourceScoped')} />
          Resource-scoped — authorization is evaluated per target resource
        </label>
      </form>
    </Modal>
  );
}
