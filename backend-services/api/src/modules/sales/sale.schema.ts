import { z } from 'zod';

const decimalString = z
  .string()
  .trim()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, 'Must be a decimal with up to two places');

export const listSalesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  customerId: z.string().uuid().optional(),
  paymentReceived: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export type ListSalesQuery = z.infer<typeof listSalesQuerySchema>;

export const saleIdParamsSchema = z.object({ id: z.string().uuid() });
export type SaleIdParams = z.infer<typeof saleIdParamsSchema>;

export const createSaleBodySchema = z
  .object({
    customerId: z.string().uuid(),
    date: z.string().datetime(),
    discountApplied: decimalString
      .refine((value) => Number(value) <= 100, 'Discount cannot exceed 100%')
      .default('0.00'),
    paymentReceived: z.boolean().default(false),
    dateOfPayment: z.string().datetime().nullable().optional(),
    items: z
      .array(
        z.object({
          productId: z.string().uuid(),
          quantity: z.number().int().positive().max(100000),
        }),
      )
      .min(1, 'At least one line item is required'),
  })
  .superRefine((value, ctx) => {
    const ids = new Set<string>();
    for (const item of value.items) {
      if (ids.has(item.productId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Duplicate product in line items',
          path: ['items'],
        });
      }
      ids.add(item.productId);
    }
    if (value.paymentReceived && !value.dateOfPayment) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'dateOfPayment is required when paymentReceived is true',
        path: ['dateOfPayment'],
      });
    }
  });

export type CreateSaleBody = z.infer<typeof createSaleBodySchema>;
