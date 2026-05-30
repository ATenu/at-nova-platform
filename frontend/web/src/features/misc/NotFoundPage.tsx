import { useNavigate } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';

export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="state" style={{ paddingTop: 80 }}>
      <div className="state-icon">
        <Icon name="search" size={26} />
      </div>
      <div className="stack" style={{ gap: 6, alignItems: 'center' }}>
        <h1 className="page-title">Page not found</h1>
        <p className="muted text-sm">The page you&apos;re looking for doesn&apos;t exist.</p>
      </div>
      <Button onClick={() => navigate('/app')}>Back to dashboard</Button>
    </div>
  );
}
