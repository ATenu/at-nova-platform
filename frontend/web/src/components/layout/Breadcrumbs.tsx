import { Fragment } from 'react';
import { Link, useLocation } from 'react-router-dom';

const LABELS: Record<string, string> = {
  app: 'Home',
  chat: 'Agent Chat',
  admin: 'Admin',
  users: 'Users',
  roles: 'Roles & Permissions',
  customers: 'Customers',
  products: 'Products',
  sales: 'Sales',
  issues: 'Issues',
  actions: 'Actions',
  sops: 'SOPs',
  new: 'New',
  edit: 'Edit',
};

function labelFor(segment: string): string {
  const known = LABELS[segment];
  if (known) {
    return known;
  }
  // Detail routes use ids/seed keys; present them compactly.
  if (segment.length > 18) {
    return 'Detail';
  }
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

export function Breadcrumbs() {
  const { pathname } = useLocation();
  const segments = pathname.split('/').filter(Boolean);

  const crumbs = segments.map((segment, index) => ({
    label: labelFor(segment),
    to: `/${segments.slice(0, index + 1).join('/')}`,
    last: index === segments.length - 1,
  }));

  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      {crumbs.map((crumb) => (
        <Fragment key={crumb.to}>
          {crumb.last ? (
            <span style={{ color: 'var(--text)' }} aria-current="page">
              {crumb.label}
            </span>
          ) : (
            <Link to={crumb.to}>{crumb.label}</Link>
          )}
          {!crumb.last ? <span className="sep">/</span> : null}
        </Fragment>
      ))}
    </nav>
  );
}
