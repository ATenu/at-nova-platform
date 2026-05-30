import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createUser, type CreateUserRequest } from '@/api/admin.api';
import { queryKeys } from '@/api/queryClient';
import { NOVA_ROLES, roleLabel } from '@/auth/permissions';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { FormField, TextInput } from '@/components/ui/FormField';
import { useToast } from '@/components/ui/toast';
import { toUserMessage } from '@/lib/errors';

const createUserSchema = z.object({
  email: z.string().trim().email('Enter a valid email'),
  firstName: z.string().trim().min(1, 'First name is required'),
  lastName: z.string().trim().min(1, 'Last name is required'),
  middleName: z.string().trim().optional(),
  description: z.string().trim().optional(),
  roles: z.array(z.enum(NOVA_ROLES)).min(1, 'Assign at least one role'),
  sendResetPasswordEmail: z.boolean().optional(),
});

type CreateUserForm = z.input<typeof createUserSchema>;

export function UserFormModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateUserForm>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      email: '',
      firstName: '',
      lastName: '',
      middleName: '',
      description: '',
      roles: [],
      sendResetPasswordEmail: true,
    },
  });

  const mutation = useMutation({
    mutationFn: (values: CreateUserForm) => {
      const body: CreateUserRequest = {
        email: values.email,
        firstName: values.firstName,
        lastName: values.lastName,
        middleName: values.middleName ? values.middleName : null,
        description: values.description ? values.description : null,
        roles: values.roles,
        sendResetPasswordEmail: values.sendResetPasswordEmail ?? false,
      };
      return createUser(body);
    },
    onSuccess: (user) => {
      toast.success(`User created · Keycloak ${user.keycloak.syncStatus}`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.users });
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
      title="Create user"
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
            Create user
          </Button>
        </>
      }
    >
      <form className="stack" onSubmit={handleSubmit((values) => mutation.mutate(values))}>
        <FormField label="Email" htmlFor="email" error={errors.email?.message}>
          <TextInput id="email" type="email" invalid={Boolean(errors.email)} {...register('email')} />
        </FormField>
        <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <FormField label="First name" htmlFor="firstName" error={errors.firstName?.message}>
            <TextInput id="firstName" invalid={Boolean(errors.firstName)} {...register('firstName')} />
          </FormField>
          <FormField label="Last name" htmlFor="lastName" error={errors.lastName?.message}>
            <TextInput id="lastName" invalid={Boolean(errors.lastName)} {...register('lastName')} />
          </FormField>
        </div>
        <FormField label="Middle name (optional)" htmlFor="middleName">
          <TextInput id="middleName" {...register('middleName')} />
        </FormField>
        <FormField label="Description (optional)" htmlFor="description">
          <TextInput id="description" {...register('description')} />
        </FormField>

        <FormField label="Roles" error={errors.roles?.message}>
          <div className="stack" style={{ gap: 8 }}>
            {NOVA_ROLES.map((role) => (
              <label key={role} className="checkbox">
                <input type="checkbox" value={role} {...register('roles')} />
                {roleLabel(role)}
              </label>
            ))}
          </div>
        </FormField>

        <label className="checkbox">
          <input type="checkbox" {...register('sendResetPasswordEmail')} />
          Send a password setup email via Keycloak
        </label>
      </form>
    </Modal>
  );
}
