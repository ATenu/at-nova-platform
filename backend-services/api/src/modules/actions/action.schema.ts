import { z } from 'zod';
import { IssueActionStatus } from '@nova/database';

const actionStatusSchema = z.nativeEnum(IssueActionStatus);

export const listActionsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(50),
  status: actionStatusSchema.optional(),
  assignedOwnerId: z.string().uuid().optional(),
  issueId: z.string().uuid().optional(),
});

export type ListActionsQuery = z.infer<typeof listActionsQuerySchema>;

export const actionIdParamsSchema = z.object({ id: z.string().uuid() });
export type ActionIdParams = z.infer<typeof actionIdParamsSchema>;

export const updateActionBodySchema = z
  .object({
    status: actionStatusSchema.optional(),
    description: z.string().trim().min(1).max(5000).optional(),
    assignedOwnerId: z.string().uuid().optional(),
  })
  .refine(
    (value) =>
      value.status !== undefined ||
      value.description !== undefined ||
      value.assignedOwnerId !== undefined,
    'Provide at least one field to update',
  );

export type UpdateActionBody = z.infer<typeof updateActionBodySchema>;

export const addCommentBodySchema = z.object({
  comment: z.string().trim().min(1).max(5000),
  datetime: z.string().datetime(),
});

export type AddCommentBody = z.infer<typeof addCommentBodySchema>;

export const createActionBodySchema = z.object({
  issueId: z.string().uuid(),
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().min(1).max(5000),
  assignedOwnerId: z.string().uuid().optional(),
  status: actionStatusSchema.optional(),
});

export type CreateActionBody = z.infer<typeof createActionBodySchema>;
