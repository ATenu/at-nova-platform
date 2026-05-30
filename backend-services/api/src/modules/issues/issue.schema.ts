import { z } from 'zod';
import { CustomerIssueStatus } from '@nova/database';

const issueStatusSchema = z.nativeEnum(CustomerIssueStatus);

export const listIssuesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  status: issueStatusSchema.optional(),
  customerId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export type ListIssuesQuery = z.infer<typeof listIssuesQuerySchema>;

export const issueIdParamsSchema = z.object({ id: z.string().uuid() });
export type IssueIdParams = z.infer<typeof issueIdParamsSchema>;

export const createIssueBodySchema = z.object({
  salesId: z.string().uuid(),
  description: z.string().trim().min(1).max(5000),
  dateRaised: z.string().datetime(),
  status: issueStatusSchema,
});

export type CreateIssueBody = z.infer<typeof createIssueBodySchema>;

export const updateIssueBodySchema = z
  .object({
    description: z.string().trim().min(1).max(5000).optional(),
    status: issueStatusSchema.optional(),
    dateLastUpdate: z.string().datetime().optional(),
  })
  .refine(
    (value) => value.description !== undefined || value.status !== undefined,
    'Provide at least a description or status to update',
  );

export type UpdateIssueBody = z.infer<typeof updateIssueBodySchema>;
