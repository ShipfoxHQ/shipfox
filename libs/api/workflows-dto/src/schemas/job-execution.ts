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
    // The attempt number this dispatch runs (the step's current attempt). The
    // runner echoes it back on report so a late report from a superseded attempt
    // is ignored. 1 until a durable restart (PR E) bumps it.
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
    // The attempt the runner was dispatched, echoed from next-step. Optional on
    // the wire (older runners omit it); when present it drives attempt-aware
    // idempotency in `recordStepResult`.
    attempt: z.number().int().positive().optional(),
    // Process exit code on success and failure. Persisted on the step attempt;
    // consumed by gate evaluation (success_if: exit_code == 0) in PR D. On
    // failure it is also carried under `error.exit_code`.
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
