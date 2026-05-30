import { http } from './httpClient';
import type { AdminUserDto, PaginatedResult, PermissionDto, RoleDto } from './types';

/**
 * Admin API. User mutations are intentionally backend-driven: the browser never
 * talks to Keycloak Admin REST APIs. The backend owns creating/updating the
 * application user, the role mappings, and the Keycloak provisioning (via the
 * `nova-api` service account), returning the resulting profile plus a sync
 * status. All `/admin/*` routes run behind the centralized auth pipeline
 * (`read-users` / `write-users` / `read-permissions`). Mock mode mirrors this.
 */

export interface ListUsersParams {
  readonly page?: number | undefined;
  readonly pageSize?: number | undefined;
  readonly search?: string | undefined;
  readonly role?: string | undefined;
}

export interface CreateUserRequest {
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly middleName?: string | null;
  readonly description?: string | null;
  readonly roles: readonly string[];
  readonly sendResetPasswordEmail?: boolean;
}

export interface UpdateUserRequest {
  readonly firstName?: string;
  readonly lastName?: string;
  readonly middleName?: string | null;
  readonly description?: string | null;
  readonly active?: boolean;
}

export function listUsers(params: ListUsersParams = {}): Promise<PaginatedResult<AdminUserDto>> {
  return http.get<PaginatedResult<AdminUserDto>>('/admin/users', {
    query: {
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 20,
      ...(params.search ? { search: params.search } : {}),
      ...(params.role ? { role: params.role } : {}),
    },
  });
}

export function createUser(body: CreateUserRequest): Promise<AdminUserDto> {
  return http.post<AdminUserDto>('/admin/users', body);
}

export function updateUser(id: string, body: UpdateUserRequest): Promise<AdminUserDto> {
  return http.patch<AdminUserDto>(`/admin/users/${id}`, body);
}

export function setUserRoles(id: string, roles: readonly string[]): Promise<AdminUserDto> {
  return http.put<AdminUserDto>(`/admin/users/${id}/roles`, { roles });
}

export function syncUserToKeycloak(id: string): Promise<AdminUserDto> {
  return http.post<AdminUserDto>(`/admin/users/${id}/sync-keycloak`);
}

export function listRoles(): Promise<readonly RoleDto[]> {
  return http.get<readonly RoleDto[]>('/admin/roles');
}

export function listPermissions(): Promise<readonly PermissionDto[]> {
  return http.get<readonly PermissionDto[]>('/admin/permissions');
}

export interface RolePermissionMatrixDto {
  readonly roles: readonly RoleDto[];
  readonly permissions: readonly PermissionDto[];
  /** role name -> granted permission names. */
  readonly grants: Record<string, readonly string[]>;
  readonly totalGrants: number;
}

/**
 * The role -> permission matrix is read-only: it reflects the grants the backend
 * enforces (sourced from `@nova/shared`). There is intentionally no runtime
 * write endpoint, since editing a row could never change the enforced policy.
 */
export function getRolePermissionMatrix(): Promise<RolePermissionMatrixDto> {
  return http.get<RolePermissionMatrixDto>('/admin/role-permissions');
}
