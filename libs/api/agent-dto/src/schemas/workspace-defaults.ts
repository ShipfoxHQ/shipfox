import {z} from 'zod';
import {harnessSchema} from './catalog.js';

export const setDefaultHarnessBodySchema = z.object({
  harness_id: harnessSchema,
});

export type SetDefaultHarnessBodyDto = z.infer<typeof setDefaultHarnessBodySchema>;

export const setDefaultHarnessResponseSchema = z.object({
  default_harness_id: harnessSchema,
});

export type SetDefaultHarnessResponseDto = z.infer<typeof setDefaultHarnessResponseSchema>;
