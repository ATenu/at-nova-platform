import { z } from 'zod';

/**
 * RBAC identifier: lowercase-friendly, URL/Keycloak-safe slug. Roles, permissions
 * and capability ids all share this shape so admin-authored values stay portable
 * across the database, the API, Keycloak realm roles, and the agents.
 */
const rbacName = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, 'Use letters, digits, dot, hyphen or underscore');

const description = z.string().trim().max(2000).nullable().optional();
const permissionList = z
  .array(rbacName)
  .max(200)
  .refine((values) => new Set(values).size === values.length, 'Duplicate permission');

export const roleNameParamsSchema = z.object({ name: rbacName });
export type RoleNameParams = z.infer<typeof roleNameParamsSchema>;

export const permissionNameParamsSchema = z.object({ name: rbacName });
export type PermissionNameParams = z.infer<typeof permissionNameParamsSchema>;

export const createRoleBodySchema = z.object({ name: rbacName, description });
export type CreateRoleBody = z.infer<typeof createRoleBodySchema>;

export const updateRoleBodySchema = z.object({ description: z.string().trim().max(2000).nullable() });
export type UpdateRoleBody = z.infer<typeof updateRoleBodySchema>;

export const createPermissionBodySchema = z.object({ name: rbacName, description });
export type CreatePermissionBody = z.infer<typeof createPermissionBodySchema>;

export const updatePermissionBodySchema = z.object({
  description: z.string().trim().max(2000).nullable(),
});
export type UpdatePermissionBody = z.infer<typeof updatePermissionBodySchema>;

export const setRolePermissionsBodySchema = z.object({ permissions: permissionList });
export type SetRolePermissionsBody = z.infer<typeof setRolePermissionsBodySchema>;

export const capabilityIdParamsSchema = z.object({ id: rbacName });
export type CapabilityIdParams = z.infer<typeof capabilityIdParamsSchema>;

export const updateCapabilityBodySchema = z
  .object({
    enabled: z.boolean().optional(),
    risk: z.enum(['low', 'high']).optional(),
    requiresApproval: z.boolean().optional(),
    requiredPermissions: permissionList.optional(),
    description: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update');
export type UpdateCapabilityBody = z.infer<typeof updateCapabilityBodySchema>;

export const createCapabilityBodySchema = z.object({
  id: rbacName,
  kind: z.enum(['agent-skill', 'mcp-tool']),
  mode: z.enum(['read', 'write']),
  risk: z.enum(['low', 'high']),
  resourceScoped: z.boolean().optional().default(false),
  delegated: z.boolean().optional().default(false),
  requiresApproval: z.boolean().optional().default(false),
  requiredPermissions: permissionList,
  description,
});
export type CreateCapabilityBody = z.infer<typeof createCapabilityBodySchema>;

export const routeIdParamsSchema = z.object({ routeId: z.string().trim().min(1).max(150) });
export type RouteIdParams = z.infer<typeof routeIdParamsSchema>;

export const updateRoutePolicyBodySchema = z
  .object({
    kind: z.enum(['public', 'authenticated', 'permission']),
    permissionName: rbacName.nullable().optional(),
    audit: z.boolean().optional(),
  })
  .refine(
    (value) => value.kind !== 'permission' || (value.permissionName?.length ?? 0) > 0,
    'A permission-gated route requires permissionName',
  );
export type UpdateRoutePolicyBody = z.infer<typeof updateRoutePolicyBodySchema>;

export const viewPermissionParamsSchema = z.object({
  viewName: z.string().trim().min(1).max(100),
  mode: z.enum(['read', 'write']),
});
export type ViewPermissionParams = z.infer<typeof viewPermissionParamsSchema>;

export const updateViewPermissionBodySchema = z.object({ permissionName: rbacName });
export type UpdateViewPermissionBody = z.infer<typeof updateViewPermissionBodySchema>;
