import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth } from '@/auth/RequireAuth';
import { RequirePermission } from '@/auth/RequirePermission';
import { AppShell } from '@/components/layout/AppShell';
import { LoginPage } from '@/features/auth/LoginPage';
import { LogoutRoute } from '@/features/auth/LogoutRoute';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { AgentChatPage } from '@/features/chat/AgentChatPage';
import { CustomersPage } from '@/features/customers/CustomersPage';
import { ProductsPage } from '@/features/products/ProductsPage';
import { SalesPage } from '@/features/sales/SalesPage';
import { NewSalePage } from '@/features/sales/NewSalePage';
import { SaleDetailPage } from '@/features/sales/SaleDetailPage';
import { IssuesPage } from '@/features/issues/IssuesPage';
import { NewIssuePage } from '@/features/issues/NewIssuePage';
import { IssueDetailPage } from '@/features/issues/IssueDetailPage';
import { ActionsPage } from '@/features/actions/ActionsPage';
import { SopsPage } from '@/features/sops/SopsPage';
import { SopDetailPage } from '@/features/sops/SopDetailPage';
import { SopEditorPage } from '@/features/sops/SopEditorPage';
import { AdminUsersPage } from '@/features/admin/AdminUsersPage';
import { RolesPermissionsPage } from '@/features/admin/RolesPermissionsPage';
import { AgentRegistryPage } from '@/features/admin/AgentRegistryPage';
import { NotFoundPage } from '@/features/misc/NotFoundPage';

/**
 * Application routes. Permission guards wrap route groups for UX only; the
 * backend independently authorizes every request. Routes intentionally mirror
 * the documented route map.
 */
export function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<RequireAuth />}>
        <Route path="/logout" element={<LogoutRoute />} />
        <Route path="/app" element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="chat" element={<AgentChatPage />} />

          <Route element={<RequirePermission anyOf={['read-customers']} />}>
            <Route path="customers" element={<CustomersPage />} />
          </Route>

          <Route element={<RequirePermission anyOf={['read-sales']} />}>
            <Route path="products" element={<ProductsPage />} />
            <Route path="sales" element={<SalesPage />} />
            <Route path="sales/:id" element={<SaleDetailPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={['write-sales']} />}>
            <Route path="sales/new" element={<NewSalePage />} />
          </Route>

          <Route element={<RequirePermission anyOf={['read-issues']} />}>
            <Route path="issues" element={<IssuesPage />} />
            <Route path="issues/:id" element={<IssueDetailPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={['create-issues']} />}>
            <Route path="issues/new" element={<NewIssuePage />} />
          </Route>

          <Route element={<RequirePermission anyOf={['read-actions']} />}>
            <Route path="actions" element={<ActionsPage />} />
          </Route>

          <Route element={<RequirePermission anyOf={['read-sop']} />}>
            <Route path="sops" element={<SopsPage />} />
            <Route path="sops/:id" element={<SopDetailPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={['write-sop']} />}>
            <Route path="sops/new" element={<SopEditorPage />} />
            <Route path="sops/:id/edit" element={<SopEditorPage />} />
          </Route>

          <Route element={<RequirePermission anyOf={['read-users']} />}>
            <Route path="admin/users" element={<AdminUsersPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={['read-permissions']} />}>
            <Route path="admin/roles" element={<RolesPermissionsPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={['read-agents']} />}>
            <Route path="admin/agents" element={<AgentRegistryPage />} />
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>

      <Route path="/" element={<Navigate to="/app" replace />} />
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}
