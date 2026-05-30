import type { ReactNode } from 'react';

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string | undefined;
  actions?: ReactNode | undefined;
}) {
  return (
    <div className="row-between wrap" style={{ marginBottom: 20 }}>
      <div className="stack" style={{ gap: 4 }}>
        <h1 className="page-title">{title}</h1>
        {description ? <p className="muted text-sm" style={{ margin: 0 }}>{description}</p> : null}
      </div>
      {actions ? <div className="row wrap">{actions}</div> : null}
    </div>
  );
}
