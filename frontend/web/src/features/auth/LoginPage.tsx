import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { DEMO_USERS } from '@/auth/demoUsers';
import { roleLabel } from '@/auth/permissions';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { AppBrand } from '@/components/layout/AppBrand';

/**
 * Login screen. In real deployments this immediately hands off to Keycloak. In
 * local mock mode it presents the seeded users so any role can be explored
 * without a running identity provider. No credentials are handled here.
 */
export function LoginPage() {
  const { status, useMocks, login, loginAsMockUser } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (status === 'authenticated') {
      navigate('/app', { replace: true });
    }
  }, [status, navigate]);

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div className="card" style={{ width: '100%', maxWidth: 500, overflow: 'hidden' }}>
        <div
          style={{
            padding: '28px 28px 22px',
            background: 'linear-gradient(135deg, rgba(99,102,241,0.18), rgba(6,182,212,0.12))',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <AppBrand variant="hero" />
        </div>

        <div className="card-body stack">
          {useMocks ? (
            <>
              <div className="stack" style={{ gap: 2 }}>
                <div className="section-title">Choose a demo user</div>
                <div className="text-sm muted">
                  Mock mode is on — pick a seeded role to explore the app without Keycloak.
                </div>
              </div>
              <div className="stack" style={{ gap: 8 }}>
                {DEMO_USERS.map((user) => (
                  <button
                    key={user.email}
                    className="nav-item"
                    style={{ width: '100%' }}
                    onClick={() => loginAsMockUser(user.email)}
                  >
                    <Avatar name={`${user.firstName} ${user.lastName}`} size="sm" />
                    <span className="stack grow" style={{ gap: 1, alignItems: 'flex-start' }}>
                      <span style={{ fontWeight: 600, color: 'var(--text)' }}>{user.email}</span>
                      <span className="subtle" style={{ fontSize: 11.5 }}>{user.description}</span>
                    </span>
                    <Badge tone="brand">{roleLabel(user.role)}</Badge>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="stack" style={{ gap: 2 }}>
                <div className="section-title">Sign in</div>
                <div className="text-sm muted">
                  You&apos;ll be redirected to the secure Keycloak sign-in page.
                </div>
              </div>
              <Button variant="primary" block onClick={login}>
                <Icon name="logout" size={16} /> Continue to sign in
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
