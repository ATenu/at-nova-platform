import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { Icon } from '@/components/ui/Icon';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { roleLabel } from '@/auth/permissions';
import { Breadcrumbs } from './Breadcrumbs';

export function Topbar({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  const { user, logout, useMocks } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  const fullName = user ? `${user.firstName} ${user.lastName}`.trim() : 'Account';
  const primaryRole = user?.roles[0];

  return (
    <header className="topbar">
      <button
        className="btn btn-ghost btn-icon mobile-toggle"
        onClick={onToggleSidebar}
        aria-label="Toggle navigation"
      >
        <Icon name="menu" size={20} />
      </button>

      <div className="grow">
        <Breadcrumbs />
      </div>

      {useMocks ? (
        <Badge tone="warning" dot>
          Mock mode
        </Badge>
      ) : null}

      <div className="user-menu" ref={menuRef}>
        <button
          className="user-menu-trigger"
          onClick={() => setMenuOpen((open) => !open)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <Avatar name={fullName} size="sm" />
          <span className="stack" style={{ gap: 0, alignItems: 'flex-start' }}>
            <span className="text-sm" style={{ fontWeight: 600 }}>
              {fullName}
            </span>
            {primaryRole ? <span className="subtle" style={{ fontSize: 11 }}>{roleLabel(primaryRole)}</span> : null}
          </span>
          <Icon name="chevronDown" size={15} />
        </button>

        {menuOpen ? (
          <div className="user-menu-panel" role="menu">
            <div className="card-pad" style={{ padding: '6px 10px 10px' }}>
              <div className="text-sm" style={{ fontWeight: 600 }}>{fullName}</div>
              <div className="subtle" style={{ fontSize: 11.5 }}>{user?.email}</div>
            </div>
            <button className="menu-item" role="menuitem" onClick={logout}>
              <Icon name="logout" size={16} /> Sign out
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
