import {z} from 'zod';

const CONTROL_CHARACTER_RE = /\p{Cc}/u;

export const displayNameSchema = z
  .string()
  .refine((value) => !CONTROL_CHARACTER_RE.test(value), {
    message: 'must not contain control characters',
  })
  .transform((value) => value.trim())
  .pipe(z.string().min(1).max(255));
