import {z} from 'zod';
import {stepDtoSchema, stepErrorDtoSchema} from './step.js';

/**
 * The job to progress is identified by the caller's lease-token claims, never by
 * the request. An unknown job is a 404, not a `done`.
 */
export const nextStepResponseSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('step'),
    step: stepDtoSchema,
    // The attempt number this dispatch runs. The runner echoes it back on report
    // so a late report from a superseded attempt can be ignored. Always 1 until
    // per-step attempts land (PR B: steps.current_attempt).
    attempt: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal('done'),
    status: z.enum(['succeeded', 'failed']),
  }),
]);

export type NextStepResponseDto = z.infer<typeof nextStepResponseSchema>;

export const reportStepBodySchema = z
  .object({
    status: z.enum(['succeeded', 'failed']),
    error: stepErrorDtoSchema.optional(),
    // The attempt the runner was dispatched (echoed from next-step). Optional
    // until the runner sends it (PR A.2); enforced for idempotency in PR B.
    attempt: z.number().int().positive().optional(),
    // Process exit code on success AND failure. Optional until the runner sends
    // it (PR A.2); consumed by gate evaluation (success_if: exit_code == 0) in PR D.
    exit_code: z.number().int().nullable().optional(),
  })
  .refine((body) => (body.status === 'succeeded' ? body.error == null : body.error != null), {
    message: 'succeeded steps must not include an error and failed steps must include one',
  });

export type ReportStepBodyDto = z.infer<typeof reportStepBodySchema>;

/** `cancel` tells the agent to stop working on the job: it finished without full success. */
export const reportStepResponseSchema = z.object({
  ok: z.boolean(),
  cancel: z.boolean(),
});

export type ReportStepResponseDto = z.infer<typeof reportStepResponseSchema>;
