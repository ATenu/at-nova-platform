import { z } from 'zod';

export const listProductsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().min(1).max(255).optional(),
  category: z.string().trim().min(1).max(255).optional(),
  inCatalog: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;
