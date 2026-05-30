import { z } from 'zod';

export const listSopsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(50),
  search: z.string().trim().min(1).max(255).optional(),
  active: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export type ListSopsQuery = z.infer<typeof listSopsQuerySchema>;

export const sopIdParamsSchema = z.object({ id: z.string().uuid() });
export type SopIdParams = z.infer<typeof sopIdParamsSchema>;

export const createSopBodySchema = z.object({
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().min(1).max(2000),
  active: z.boolean().default(true),
  fullText: z.string().trim().min(1).max(50000),
});

export type CreateSopBody = z.infer<typeof createSopBodySchema>;

export const updateSopBodySchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().min(1).max(2000).optional(),
    active: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined || value.description !== undefined || value.active !== undefined,
    'Provide at least one field to update',
  );

export type UpdateSopBody = z.infer<typeof updateSopBodySchema>;

export const createSopVersionBodySchema = z.object({
  fullText: z.string().trim().min(1).max(50000),
});

export type CreateSopVersionBody = z.infer<typeof createSopVersionBodySchema>;
