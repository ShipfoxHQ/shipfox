import {z} from 'zod';

export const stepErrorSchema = z
  .object({
    message: z.string(),
    exit_code: z.number().int().nullable().optional(),
    signal: z.string().optional(),
  })
  .nullable();

export type StepErrorDto = z.infer<typeof stepErrorSchema>;

export const stepResultSchema = z
  .object({
    step_id: z.string().uuid(),
    status: z.enum(['succeeded', 'failed']),
    error: stepErrorSchema,
  })
  .refine((step) => (step.status === 'succeeded' ? step.error === null : step.error !== null), {
    message: 'succeeded steps must have error=null and failed steps must include an error',
  });

export type StepResultDto = z.infer<typeof stepResultSchema>;

export const completeJobBodySchema = z
  .object({
    status: z.enum(['succeeded', 'failed']),
    steps: z.array(stepResultSchema),
  })
  .refine(
    (body) =>
      body.status !== 'succeeded' ||
      (body.steps.length > 0 && body.steps.every((s) => s.status === 'succeeded')),
    {
      message:
        'succeeded jobs must report at least one step and all reported steps must be succeeded',
    },
  );

export type CompleteJobBodyDto = z.infer<typeof completeJobBodySchema>;

export const completeJobResponseSchema = z.object({
  ok: z.boolean(),
});

export type CompleteJobResponseDto = z.infer<typeof completeJobResponseSchema>;
