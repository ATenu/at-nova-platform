import { Card } from './Card';
import { Icon, type IconName } from './Icon';

export function StatCard({
  label,
  value,
  icon,
  hint,
  loading = false,
}: {
  label: string;
  value: string | number;
  icon: IconName;
  hint?: string;
  loading?: boolean;
}) {
  return (
    <Card className="stat-card">
      <div className="card-pad row-between" style={{ alignItems: 'flex-start' }}>
        <div className="stack" style={{ gap: 6 }}>
          <span className="stat-label">{label}</span>
          {loading ? (
            <span className="skeleton" style={{ height: 30, width: 64 }} />
          ) : (
            <span className="stat-value">{value}</span>
          )}
          {hint ? <span className="text-sm subtle">{hint}</span> : null}
        </div>
        <span className="stat-icon">
          <Icon name={icon} size={20} />
        </span>
      </div>
    </Card>
  );
}
