import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="state" role="status" aria-live="polite">
      <span className="spinner" style={{ width: 28, height: 28, borderTopColor: 'var(--brand-400)' }} />
      <span className="muted">{label}</span>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon = 'sparkles',
  action,
}: {
  title: string;
  description?: string;
  icon?: IconName;
  action?: ReactNode;
}) {
  return (
    <div className="state">
      <div className="state-icon">
        <Icon name={icon} size={24} />
      </div>
      <div className="stack" style={{ gap: 4, alignItems: 'center' }}>
        <div className="section-title">{title}</div>
        {description ? <div className="text-sm muted" style={{ maxWidth: 420 }}>{description}</div> : null}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  description,
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="state state-error">
      <div className="state-icon">
        <Icon name="alert" size={24} />
      </div>
      <div className="stack" style={{ gap: 4, alignItems: 'center' }}>
        <div className="section-title">{title}</div>
        {description ? <div className="text-sm muted" style={{ maxWidth: 440 }}>{description}</div> : null}
      </div>
      {onRetry ? (
        <button className="btn btn-sm" onClick={onRetry}>
          <Icon name="refresh" size={15} /> Try again
        </button>
      ) : null}
    </div>
  );
}

export function TableSkeleton({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="card-body stack" aria-hidden>
      {Array.from({ length: rows }).map((_, r) => (
        <div className="row" key={r} style={{ gap: 16 }}>
          {Array.from({ length: columns }).map((__, c) => (
            <div
              key={c}
              className="skeleton"
              style={{ height: 16, flex: c === 0 ? '0 0 32px' : 1, borderRadius: 6 }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
