import {DISPLAY_NAME_DISALLOWED_CHARACTER_RE} from '@shipfox/regex';
import {z} from 'zod';

export const displayNameSchema = z
  .string()
  .refine((value) => !DISPLAY_NAME_DISALLOWED_CHARACTER_RE.test(value), {
    message: 'must not contain control or format characters',
  })
  .transform((value) => value.trim())
  .pipe(z.string().min(1).max(255));
