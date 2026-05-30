import { z } from 'zod';

/** Empty string from a form input should be treated as an absent optional. */
export const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value && value.length > 0 ? value : undefined));

/** Optional nullable text for fields the backend models as `string | null`. */
export const nullableText = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value && value.length > 0 ? value : null));
