import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { setUserRoles } from '@/api/admin.api';
import { queryKeys } from '@/api/queryClient';
import type { AdminUserDto } from '@/api/types';
import { NOVA_ROLES, roleLabel } from '@/auth/permissions';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/toast';
import { toUserMessage } from '@/lib/errors';

export function RoleAssignmentModal({
  user,
  onClose,
}: {
  user: AdminUserDto | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [roles, setRoles] = useState<readonly string[]>(() => user?.roles ?? []);
  const [trackedUserId, setTrackedUserId] = useState<string | null>(user?.id ?? null);

  // Reset the editable selection when a different user is opened.
  if ((user?.id ?? null) !== trackedUserId) {
    setTrackedUserId(user?.id ?? null);
    setRoles(user?.roles ?? []);
  }

  const mutation = useMutation({
    mutationFn: () => setUserRoles(user!.id, roles),
    onSuccess: () => {
      toast.success('Roles updated');
      void queryClient.invalidateQueries({ queryKey: queryKeys.users });
      onClose();
    },
    onError: (error) => toast.error(toUserMessage(error)),
  });

  const toggle = (role: string) => {
    setRoles((current) =>
      current.includes(role) ? current.filter((value) => value !== role) : [...current, role],
    );
  };

  return (
    <Modal
      open={Boolean(user)}
      onClose={onClose}
      title={user ? `Roles · ${user.email}` : 'Roles'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={mutation.isPending} onClick={() => mutation.mutate()} disabled={roles.length === 0}>
            Save roles
          </Button>
        </>
      }
    >
      <div className="stack" style={{ gap: 8 }}>
        {NOVA_ROLES.map((role) => (
          <label key={role} className="checkbox">
            <input type="checkbox" checked={roles.includes(role)} onChange={() => toggle(role)} />
            {roleLabel(role)}
          </label>
        ))}
        {roles.length === 0 ? <span className="field-error">Assign at least one role.</span> : null}
      </div>
    </Modal>
  );
}
