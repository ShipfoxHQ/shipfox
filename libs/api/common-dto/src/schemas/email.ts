import {z} from 'zod';

export const emailSchema = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .pipe(z.string().email().max(254));
