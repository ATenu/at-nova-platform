import { z } from 'zod';
import { isRole } from '@nova/shared';

const rolesSchema = z
  .array(z.string().trim().min(1))
  .max(20)
  .refine((roles) => roles.every(isRole), 'Unknown role')
  .refine((roles) => new Set(roles).size === roles.length, 'Duplicate role');

export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().min(1).max(255).optional(),
  role: z
    .string()
    .trim()
    .min(1)
    .refine(isRole, 'Unknown role')
    .optional(),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const userIdParamsSchema = z.object({ id: z.string().uuid() });
export type UserIdParams = z.infer<typeof userIdParamsSchema>;

export const createUserBodySchema = z.object({
  email: z.string().trim().email().max(320),
  firstName: z.string().trim().min(1).max(255),
  lastName: z.string().trim().min(1).max(255),
  middleName: z.string().trim().max(255).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  roles: rolesSchema,
  sendResetPasswordEmail: z.boolean().optional(),
});

export type CreateUserBody = z.infer<typeof createUserBodySchema>;

export const updateUserBodySchema = z
  .object({
    firstName: z.string().trim().min(1).max(255).optional(),
    lastName: z.string().trim().min(1).max(255).optional(),
    middleName: z.string().trim().max(255).nullable().optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update');

export type UpdateUserBody = z.infer<typeof updateUserBodySchema>;

export const setRolesBodySchema = z.object({ roles: rolesSchema });
export type SetRolesBody = z.infer<typeof setRolesBodySchema>;
