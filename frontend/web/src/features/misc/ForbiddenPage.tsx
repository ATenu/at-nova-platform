import { useNavigate } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';

export function ForbiddenPage() {
  const navigate = useNavigate();
  return (
    <div className="state state-error" style={{ paddingTop: 80 }}>
      <div className="state-icon">
        <Icon name="shield" size={26} />
      </div>
      <div className="stack" style={{ gap: 6, alignItems: 'center' }}>
        <h1 className="page-title">Access denied</h1>
        <p className="muted text-sm" style={{ maxWidth: 420 }}>
          You don&apos;t have permission to view this page. If you believe this is a mistake, contact
          an administrator.
        </p>
      </div>
      <div className="row">
        <Button onClick={() => navigate('/app')}>Back to dashboard</Button>
      </div>
    </div>
  );
}
