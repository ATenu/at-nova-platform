import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getRolePermissionMatrix } from '@/api/admin.api';
import { EXPECTED_ROLE_PERMISSION_COUNT, permissionLabel, roleLabel } from '@/auth/permissions';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Badge } from '@/components/ui/Badge';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { toUserMessage } from '@/lib/errors';

/**
 * Read-only RBAC matrix. The authoritative role -> permission grants are
 * defined and enforced by the backend (`@nova/shared` ROLE_PERMISSIONS). They
 * cannot be edited at runtime: a UI/database change could never alter the
 * enforced policy, so this screen reflects the enforced grants instead of
 * offering a misleading editor.
 */
export function RolesPermissionsPage() {
  const [searchParams] = useSearchParams();
  const highlightRole = searchParams.get('role');

  const query = useQuery({
    queryKey: ['admin', 'role-permissions'],
    queryFn: getRolePermissionMatrix,
  });

  const totalGrants = useMemo(() => query.data?.totalGrants ?? 0, [query.data]);

  if (query.isLoading) return <LoadingState label="Loading permissions…" />;
  if (query.isError || !query.data) {
    return <ErrorState description={toUserMessage(query.error)} onRetry={() => query.refetch()} />;
  }

  const { roles, permissions, grants } = query.data;

  return (
    <>
      <PageHeader
        title="Roles & Permissions"
        description="Effective permission grants per role, as enforced by the backend."
      />

      <div className="row wrap" style={{ gap: 12, marginBottom: 16 }}>
        <Badge tone={totalGrants === EXPECTED_ROLE_PERMISSION_COUNT ? 'success' : 'warning'} dot>
          {totalGrants} grants
        </Badge>
        <span className="text-sm muted">
          Expected after a clean seed: {EXPECTED_ROLE_PERMISSION_COUNT}
        </span>
        <Badge tone="neutral">Read-only · enforced by API</Badge>
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
                      const granted = (grants[role.name] ?? []).includes(permission.name);
                      return (
                        <td key={role.name} style={{ textAlign: 'center' }}>
                          <span
                            role="img"
                            aria-label={`${role.name} ${granted ? 'has' : 'does not have'} ${permission.name}`}
                            style={{
                              width: 26,
                              height: 26,
                              borderRadius: 7,
                              display: 'inline-grid',
                              placeItems: 'center',
                              border: '1px solid var(--border-strong)',
                              background: granted ? 'rgba(52,211,153,0.16)' : 'transparent',
                              color: granted ? 'var(--success)' : 'var(--text-subtle)',
                            }}
                          >
                            {granted ? <Icon name="check" size={15} /> : ''}
                          </span>
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
    </>
  );
}
