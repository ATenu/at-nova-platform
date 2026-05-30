import { z } from 'zod';

export const listCustomersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  active: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  search: z.string().trim().min(1).max(255).optional(),
});

export type ListCustomersQuery = z.infer<typeof listCustomersQuerySchema>;

export const customerIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export type CustomerIdParams = z.infer<typeof customerIdParamsSchema>;
