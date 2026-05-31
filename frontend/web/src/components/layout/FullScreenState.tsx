import { AppBrand } from '@/components/layout/AppBrand';
import { Icon } from '@/components/ui/Icon';

/** Full-viewport status screen used during boot, redirect, and fatal errors. */
export function FullScreenState({
  variant,
  title,
  message,
  onRetry,
}: {
  variant: 'loading' | 'error';
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
      }}
    >
      <div className="stack" style={{ alignItems: 'center', textAlign: 'center', maxWidth: 420 }}>
        <AppBrand variant="hero" />
        {variant === 'loading' ? (
          <span
            className="spinner"
            style={{ width: 26, height: 26, borderTopColor: 'var(--brand-400)', marginTop: 8 }}
          />
        ) : (
          <div className="state-icon state-error" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
            <Icon name="alert" size={22} />
          </div>
        )}
        {title ? <div className="section-title">{title}</div> : null}
        <div className="muted text-sm">{message}</div>
        {onRetry ? (
          <button className="btn btn-sm" onClick={onRetry} style={{ marginTop: 6 }}>
            <Icon name="refresh" size={15} /> Retry
          </button>
        ) : null}
      </div>
    </div>
  );
}
