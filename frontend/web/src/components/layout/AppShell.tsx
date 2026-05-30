import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

/** Authenticated application frame: persistent sidebar, sticky topbar, content. */
export function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="shell">
      <Sidebar open={sidebarOpen} onNavigate={() => setSidebarOpen(false)} />
      <div className="main">
        <Topbar onToggleSidebar={() => setSidebarOpen((open) => !open)} />
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
