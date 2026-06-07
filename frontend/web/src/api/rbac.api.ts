import { http } from './httpClient';
import type { CapabilityDto, KeycloakSyncStatus, RbacRegistryDto } from './types';

/**
 * RBAC registry + administration API. The registry is the single dynamic source
 * the frontend builds its authorization-aware UI from. Mutations are audited and
 * enforced by the backend; the browser never edits Keycloak directly. Every
 * mutation returns the refreshed registry so callers update their cache in one
 * round-trip.
 */

export interface RbacWriteResult {
  readonly registry: RbacRegistryDto;
  readonly keycloak: { readonly status: KeycloakSyncStatus; readonly lastSyncError: string | null } | null;
}

export function getRbacRegistry(): Promise<RbacRegistryDto> {
  return http.get<RbacRegistryDto>('/rbac/registry');
}

// --- Roles ---
export function createRole(body: { name: string; description?: string | null }): Promise<RbacWriteResult> {
  return http.post<RbacWriteResult>('/admin/roles', body);
}

export function updateRole(name: string, description: string | null): Promise<RbacWriteResult> {
  return http.patch<RbacWriteResult>(`/admin/roles/${encodeURIComponent(name)}`, { description });
}

export function deleteRole(name: string): Promise<RbacWriteResult> {
  return http.delete<RbacWriteResult>(`/admin/roles/${encodeURIComponent(name)}`);
}

export function setRolePermissions(name: string, permissions: readonly string[]): Promise<RbacWriteResult> {
  return http.put<RbacWriteResult>(`/admin/roles/${encodeURIComponent(name)}/permissions`, { permissions });
}

// --- Permissions ---
export function createPermission(body: { name: string; description?: string | null }): Promise<RbacWriteResult> {
  return http.post<RbacWriteResult>('/admin/permissions', body);
}

export function deletePermission(name: string): Promise<RbacWriteResult> {
  return http.delete<RbacWriteResult>(`/admin/permissions/${encodeURIComponent(name)}`);
}

// --- Capabilities ---

/** Body for creating a capability. Mirrors the backend `createCapabilityBodySchema`. */
export interface CreateCapabilityInput {
  readonly id: string;
  readonly kind: CapabilityDto['kind'];
  readonly mode: CapabilityDto['mode'];
  readonly risk: CapabilityDto['risk'];
  readonly resourceScoped?: boolean;
  readonly delegated?: boolean;
  readonly requiresApproval?: boolean;
  readonly requiredPermissions: readonly string[];
  readonly description?: string | null;
}

export function createCapability(body: CreateCapabilityInput): Promise<RbacWriteResult> {
  return http.post<RbacWriteResult>('/admin/capabilities', body);
}

export function updateCapability(
  id: string,
  body: Partial<
    Pick<CapabilityDto, 'enabled' | 'risk' | 'requiresApproval' | 'requiredPermissions'>
  > & {
    description?: string | null;
  },
): Promise<RbacWriteResult> {
  return http.patch<RbacWriteResult>(`/admin/capabilities/${encodeURIComponent(id)}`, body);
}

export function deleteCapability(id: string): Promise<RbacWriteResult> {
  return http.delete<RbacWriteResult>(`/admin/capabilities/${encodeURIComponent(id)}`);
}
