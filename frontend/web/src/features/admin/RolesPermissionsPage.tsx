import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createPermission,
  createRole,
  deletePermission,
  deleteRole,
  setRolePermissions,
} from '@/api/rbac.api';
import { queryKeys } from '@/api/queryClient';
import { permissionLabel, roleLabel } from '@/auth/permissions';
import { useAuth } from '@/auth/AuthProvider';
import { useRbacRegistry } from '@/auth/RbacRegistryProvider';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/FormField';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { toUserMessage } from '@/lib/errors';

const RBAC_NAME = /^[a-z][a-z0-9-]{1,98}[a-z0-9]$/;

type GrantDraft = Record<string, Set<string>>;

function buildDraft(rolePermissions: Record<string, readonly string[]>): GrantDraft {
  return Object.fromEntries(
    Object.entries(rolePermissions).map(([role, perms]) => [role, new Set(perms)]),
  );
}

/**
 * Editable RBAC grant matrix. Role -> permission grants are stored in the
 * database and served by the registry; edits are persisted through the audited
 * admin API and re-enforced by the backend without a redeploy. The UI is
 * advisory — the backend remains the authorization authority.
 */
export function RolesPermissionsPage() {
  const [searchParams] = useSearchParams();
  const highlightRole = searchParams.get('role');
  const { can } = useAuth();
  const canWrite = can('write-permissions');
  const toast = useToast();
  const queryClient = useQueryClient();
  const { roles, permissions, rolePermissions, revision, isLoading, error, refetch } =
    useRbacRegistry();

  // Re-baseline the editable draft whenever the authoritative policy changes
  // (revision bump). Adjusting state during render is the React-recommended
  // alternative to a setState-in-effect for syncing to a changing input.
  const [draftState, setDraftState] = useState<{ revision: number; draft: GrantDraft }>(() => ({
    revision,
    draft: buildDraft(rolePermissions),
  }));
  if (draftState.revision !== revision) {
    setDraftState({ revision, draft: buildDraft(rolePermissions) });
  }
  const draft = draftState.draft;
  const setDraft = (next: GrantDraft | ((prev: GrantDraft) => GrantDraft)) =>
    setDraftState((prev) => ({
      revision: prev.revision,
      draft: typeof next === 'function' ? next(prev.draft) : next,
    }));

  const totalGrants = useMemo(
    () => Object.values(draft).reduce((sum, perms) => sum + perms.size, 0),
    [draft],
  );

  const dirtyRoles = useMemo(() => {
    return roles
      .map((role) => role.name)
      .filter((name) => {
        const original = new Set(rolePermissions[name] ?? []);
        const current = draft[name] ?? new Set<string>();
        if (original.size !== current.size) return true;
        for (const perm of current) if (!original.has(perm)) return true;
        return false;
      });
  }, [roles, rolePermissions, draft]);

  const [newRole, setNewRole] = useState('');
  const [newPermission, setNewPermission] = useState('');

  const afterMutation = async (message: string) => {
    toast.success(message);
    refetch();
    await queryClient.invalidateQueries({ queryKey: ['rbac', 'registry'] });
    await queryClient.invalidateQueries({ queryKey: queryKeys.me });
  };

  const save = useMutation({
    mutationFn: async () => {
      for (const roleName of dirtyRoles) {
        await setRolePermissions(roleName, [...(draft[roleName] ?? [])]);
      }
    },
    onSuccess: () => afterMutation('Permission grants updated'),
    onError: (err) => toast.error(toUserMessage(err)),
  });

  const addRole = useMutation({
    mutationFn: () => createRole({ name: newRole }),
    onSuccess: async () => {
      setNewRole('');
      await afterMutation('Role created');
    },
    onError: (err) => toast.error(toUserMessage(err)),
  });

  const removeRole = useMutation({
    mutationFn: (name: string) => deleteRole(name),
    onSuccess: () => afterMutation('Role deleted'),
    onError: (err) => toast.error(toUserMessage(err)),
  });

  const addPermission = useMutation({
    mutationFn: () => createPermission({ name: newPermission }),
    onSuccess: async () => {
      setNewPermission('');
      await afterMutation('Permission created');
    },
    onError: (err) => toast.error(toUserMessage(err)),
  });

  const removePermission = useMutation({
    mutationFn: (name: string) => deletePermission(name),
    onSuccess: () => afterMutation('Permission deleted'),
    onError: (err) => toast.error(toUserMessage(err)),
  });

  if (isLoading) return <LoadingState label="Loading permissions…" />;
  if (error) return <ErrorState description={toUserMessage(error)} onRetry={() => refetch()} />;

  const toggle = (roleName: string, permission: string) => {
    if (!canWrite) return;
    setDraft((prev) => {
      const next = { ...prev };
      const set = new Set(next[roleName] ?? []);
      if (set.has(permission)) set.delete(permission);
      else set.add(permission);
      next[roleName] = set;
      return next;
    });
  };

  const hasChanges = dirtyRoles.length > 0;

  return (
    <>
      <PageHeader
        title="Roles & Permissions"
        description="Edit which permissions each role grants. Changes apply immediately across the platform."
        actions={
          canWrite ? (
            <div className="row" style={{ gap: 8 }}>
              {hasChanges && (
                <Button variant="ghost" onClick={() => setDraft(buildDraft(rolePermissions))}>
                  Discard
                </Button>
              )}
              <Button
                variant="primary"
                disabled={!hasChanges || save.isPending}
                onClick={() => save.mutate()}
              >
                {save.isPending ? 'Saving…' : `Save changes${hasChanges ? ` (${dirtyRoles.length})` : ''}`}
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="row wrap" style={{ gap: 12, marginBottom: 16 }}>
        <Badge tone="neutral" dot>
          {totalGrants} grants
        </Badge>
        <Badge tone={canWrite ? 'success' : 'neutral'}>
          {canWrite ? 'Editable · enforced by API' : 'Read-only · enforced by API'}
        </Badge>
        {hasChanges && <Badge tone="warning">Unsaved changes</Badge>}
      </div>

      <Card>
        <CardHeader title="Permission matrix" />
        <CardBody>
          <div className="table-wrap" style={{ border: 'none' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Permission</th>
                  {roles.map((role) => (
                    <th
                      key={role.name}
                      style={{
                        textAlign: 'center',
                        color: highlightRole === role.name ? 'var(--brand-400)' : undefined,
                      }}
                    >
                      {roleLabel(role.name)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {permissions.map((permission) => (
                  <tr key={permission.name}>
                    <td style={{ fontWeight: 540 }}>{permissionLabel(permission.name)}</td>
                    {roles.map((role) => {
                      const granted = (draft[role.name] ?? new Set<string>()).has(permission.name);
                      return (
                        <td key={role.name} style={{ textAlign: 'center' }}>
                          <button
                            type="button"
                            disabled={!canWrite}
                            onClick={() => toggle(role.name, permission.name)}
                            aria-pressed={granted}
                            aria-label={`${granted ? 'Revoke' : 'Grant'} ${permission.name} for ${role.name}`}
                            style={{
                              width: 26,
                              height: 26,
                              borderRadius: 7,
                              display: 'inline-grid',
                              placeItems: 'center',
                              border: '1px solid var(--border-strong)',
                              background: granted ? 'rgba(52,211,153,0.16)' : 'transparent',
                              color: granted ? 'var(--success)' : 'var(--text-subtle)',
                              cursor: canWrite ? 'pointer' : 'default',
                            }}
                          >
                            {granted ? <Icon name="check" size={15} /> : ''}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      {canWrite && (
        <div className="row wrap" style={{ gap: 16, marginTop: 16, alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 320px' }}>
          <Card>
            <CardHeader title="Roles" />
            <CardBody>
              <div className="row" style={{ gap: 8, marginBottom: 12 }}>
                <TextInput
                  value={newRole}
                  placeholder="new-role-name"
                  onChange={(e) => setNewRole(e.target.value.trim())}
                  invalid={newRole.length > 0 && !RBAC_NAME.test(newRole)}
                />
                <Button
                  variant="primary"
                  disabled={!RBAC_NAME.test(newRole) || addRole.isPending}
                  onClick={() => addRole.mutate()}
                >
                  Add
                </Button>
              </div>
              <ul className="stack" style={{ gap: 6, listStyle: 'none', padding: 0, margin: 0 }}>
                {roles.map((role) => (
                  <li key={role.name} className="row" style={{ justifyContent: 'space-between' }}>
                    <span>
                      {roleLabel(role.name)}{' '}
                      {role.isSystem && <Badge tone="neutral">system</Badge>}
                    </span>
                    {!role.isSystem && (
                      <Button
                        variant="ghost"
                        disabled={removeRole.isPending}
                        onClick={() => removeRole.mutate(role.name)}
                        aria-label={`Delete role ${role.name}`}
                      >
                        <Icon name="close" size={15} />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
          </div>

          <div style={{ flex: '1 1 320px' }}>
          <Card>
            <CardHeader title="Permissions" />
            <CardBody>
              <div className="row" style={{ gap: 8, marginBottom: 12 }}>
                <TextInput
                  value={newPermission}
                  placeholder="read-something"
                  onChange={(e) => setNewPermission(e.target.value.trim())}
                  invalid={newPermission.length > 0 && !RBAC_NAME.test(newPermission)}
                />
                <Button
                  variant="primary"
                  disabled={!RBAC_NAME.test(newPermission) || addPermission.isPending}
                  onClick={() => addPermission.mutate()}
                >
                  Add
                </Button>
              </div>
              <ul className="stack" style={{ gap: 6, listStyle: 'none', padding: 0, margin: 0 }}>
                {permissions.map((permission) => (
                  <li key={permission.name} className="row" style={{ justifyContent: 'space-between' }}>
                    <span>
                      {permissionLabel(permission.name)}{' '}
                      {permission.isSystem && <Badge tone="neutral">system</Badge>}
                    </span>
                    {!permission.isSystem && (
                      <Button
                        variant="ghost"
                        disabled={removePermission.isPending}
                        onClick={() => removePermission.mutate(permission.name)}
                        aria-label={`Delete permission ${permission.name}`}
                      >
                        <Icon name="close" size={15} />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
          </div>
        </div>
      )}
    </>
  );
}
