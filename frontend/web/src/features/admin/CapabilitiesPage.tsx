import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { deleteCapability, updateCapability } from '@/api/rbac.api';
import { queryKeys } from '@/api/queryClient';
import { permissionLabel, roleLabel } from '@/auth/permissions';
import { useAuth } from '@/auth/AuthProvider';
import { useRbacRegistry } from '@/auth/RbacRegistryProvider';
import type { CapabilityDto } from '@/api/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { toUserMessage } from '@/lib/errors';
import { CapabilityFormModal } from './CapabilityFormModal';

/**
 * Admin surface for RBAC capabilities — the bridge between an agent's advertised
 * skills (the capability id) and the permissions a caller must hold. Admins
 * create capabilities here, attach the required permissions, then grant those
 * permissions to roles in the grant matrix. All writes are persisted through the
 * audited admin API and re-enforced by the backend without a redeploy.
 */
export function CapabilitiesPage() {
  const { can } = useAuth();
  const canWrite = can('write-permissions');
  const toast = useToast();
  const queryClient = useQueryClient();
  const { capabilities, permissions, rolePermissions, isLoading, error, refetch } =
    useRbacRegistry();

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<CapabilityDto | null>(null);

  // For each capability, the roles that hold *all* of its required permissions —
  // i.e. the roles whose members can actually invoke the skill.
  const rolesByCapability = useMemo(() => {
    const grantSets = Object.entries(rolePermissions).map(
      ([role, perms]) => [role, new Set(perms)] as const,
    );
    const map = new Map<string, string[]>();
    for (const capability of capabilities) {
      const roles = grantSets
        .filter(([, set]) => capability.requiredPermissions.every((perm) => set.has(perm)))
        .map(([role]) => role);
      map.set(capability.id, roles);
    }
    return map;
  }, [capabilities, rolePermissions]);

  const afterMutation = async (message: string) => {
    toast.success(message);
    refetch();
    await queryClient.invalidateQueries({ queryKey: ['rbac', 'registry'] });
    await queryClient.invalidateQueries({ queryKey: queryKeys.me });
  };

  const toggleEnabled = useMutation({
    mutationFn: (capability: CapabilityDto) =>
      updateCapability(capability.id, { enabled: !capability.enabled }),
    onSuccess: (_r, capability) =>
      afterMutation(capability.enabled ? 'Capability disabled' : 'Capability enabled'),
    onError: (err) => toast.error(toUserMessage(err)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteCapability(id),
    onSuccess: () => afterMutation('Capability deleted'),
    onError: (err) => toast.error(toUserMessage(err)),
  });

  if (isLoading) return <LoadingState label="Loading capabilities…" />;
  if (error) return <ErrorState description={toUserMessage(error)} onRetry={() => refetch()} />;

  const sorted = [...capabilities].sort((a, b) => a.id.localeCompare(b.id));
  const highRisk = capabilities.filter((capability) => capability.risk === 'high').length;

  return (
    <>
      <PageHeader
        title="Capabilities"
        description="Map agent skills to the permissions a caller must hold, then grant those permissions to roles."
        actions={
          canWrite ? (
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              <Icon name="plus" size={16} /> New capability
            </Button>
          ) : undefined
        }
      />

      <div className="row wrap" style={{ gap: 12, marginBottom: 16 }}>
        <Badge tone="neutral" dot>
          {capabilities.length} capabilities
        </Badge>
        {highRisk > 0 && <Badge tone="warning">{highRisk} high-risk</Badge>}
        <Badge tone={canWrite ? 'success' : 'neutral'}>
          {canWrite ? 'Editable · enforced by API' : 'Read-only · enforced by API'}
        </Badge>
      </div>

      <Card>
        <CardHeader title="Capability catalog" />
        <CardBody>
          <div className="table-wrap" style={{ border: 'none' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Capability</th>
                  <th>Type</th>
                  <th>Risk</th>
                  <th>Status</th>
                  <th>Required permissions</th>
                  <th>Usable by roles</th>
                  {canWrite && <th aria-label="Actions" />}
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={canWrite ? 7 : 6} className="muted">
                      No capabilities defined yet.
                    </td>
                  </tr>
                )}
                {sorted.map((capability) => {
                  const roles = rolesByCapability.get(capability.id) ?? [];
                  return (
                    <tr key={capability.id}>
                      <td>
                        <div style={{ fontWeight: 540 }}>
                          <code>{capability.id}</code>{' '}
                          {capability.isSystem && <Badge tone="neutral">system</Badge>}
                        </div>
                      </td>
                      <td>
                        <div className="row" style={{ gap: 6 }}>
                          <Badge tone="info">{capability.kind}</Badge>
                          <Badge tone="neutral">{capability.mode}</Badge>
                          {capability.delegated && <Badge tone="neutral">delegated</Badge>}
                        </div>
                      </td>
                      <td>
                        <div className="row" style={{ gap: 6 }}>
                          <Badge tone={capability.risk === 'high' ? 'danger' : 'neutral'}>
                            {capability.risk}
                          </Badge>
                          {capability.requiresApproval && <Badge tone="warning">approval</Badge>}
                        </div>
                      </td>
                      <td>
                        {canWrite ? (
                          <button
                            type="button"
                            disabled={toggleEnabled.isPending}
                            onClick={() => toggleEnabled.mutate(capability)}
                            aria-label={`${capability.enabled ? 'Disable' : 'Enable'} ${capability.id}`}
                            style={{
                              background: 'none',
                              border: 'none',
                              padding: 0,
                              cursor: 'pointer',
                            }}
                          >
                            <Badge tone={capability.enabled ? 'success' : 'neutral'}>
                              {capability.enabled ? 'enabled' : 'disabled'}
                            </Badge>
                          </button>
                        ) : (
                          <Badge tone={capability.enabled ? 'success' : 'neutral'}>
                            {capability.enabled ? 'enabled' : 'disabled'}
                          </Badge>
                        )}
                      </td>
                      <td>
                        <div className="row wrap" style={{ gap: 4 }}>
                          {capability.requiredPermissions.length === 0 && (
                            <span className="muted text-sm">none</span>
                          )}
                          {capability.requiredPermissions.map((perm) => (
                            <Badge key={perm} tone="neutral">
                              {permissionLabel(perm)}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td>
                        <div className="row wrap" style={{ gap: 4 }}>
                          {roles.length === 0 && <span className="muted text-sm">none</span>}
                          {roles.map((role) => (
                            <Badge key={role} tone="brand">
                              {roleLabel(role)}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      {canWrite && (
                        <td>
                          <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                            <Button
                              variant="ghost"
                              onClick={() => setEditing(capability)}
                              aria-label={`Edit ${capability.id}`}
                            >
                              <Icon name="edit" size={15} />
                            </Button>
                            {!capability.isSystem && (
                              <Button
                                variant="ghost"
                                disabled={remove.isPending}
                                onClick={() => remove.mutate(capability.id)}
                                aria-label={`Delete ${capability.id}`}
                              >
                                <Icon name="close" size={15} />
                              </Button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      {canWrite && (
        <CapabilityFormModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          permissions={permissions}
        />
      )}
      {canWrite && editing && (
        <CapabilityFormModal
          open
          onClose={() => setEditing(null)}
          capability={editing}
          permissions={permissions}
        />
      )}
    </>
  );
}
