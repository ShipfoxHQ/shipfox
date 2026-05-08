import {z} from 'zod';

export const stepErrorDtoSchema = z
  .object({
    message: z.string(),
    exit_code: z.number().int().nullable().optional(),
    signal: z.string().optional(),
  })
  .nullable();

export type StepErrorDtoShape = z.infer<typeof stepErrorDtoSchema>;

export const stepDtoSchema = z.object({
  id: z.string().uuid(),
  job_id: z.string().uuid(),
  name: z.string().nullable(),
  status: z.string(),
  type: z.string(),
  config: z.record(z.unknown()),
  error: stepErrorDtoSchema,
  position: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type StepDto = z.infer<typeof stepDtoSchema>;
