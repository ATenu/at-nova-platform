import { NavLink } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { Icon } from '@/components/ui/Icon';
import type { NovaPermission } from '@/auth/permissions';
import { NAV_GROUPS, type NavItem } from './navigation';

function isVisible(item: NavItem, canAny: (p: readonly NovaPermission[]) => boolean): boolean {
  return item.anyOf === undefined || canAny(item.anyOf);
}

export function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const { canAny } = useAuth();

  return (
    <>
      <div className={`sidebar-backdrop ${open ? 'open' : ''}`} onClick={onNavigate} role="presentation" />
      <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Primary navigation">
        <div className="sidebar-brand">
          <img src="/nova.svg" alt="" />
          <span className="brand-name">Nova</span>
        </div>

        {NAV_GROUPS.map((group) => {
          const visibleItems = group.items.filter((item) => isVisible(item, canAny));
          if (visibleItems.length === 0) {
            return null;
          }
          return (
            <nav key={group.label}>
              <div className="nav-group-label">{group.label}</div>
              {visibleItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end ?? false}
                  className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                  onClick={onNavigate}
                >
                  <span className="nav-ico">
                    <Icon name={item.icon} size={18} />
                  </span>
                  {item.label}
                </NavLink>
              ))}
            </nav>
          );
        })}
      </aside>
    </>
  );
}
