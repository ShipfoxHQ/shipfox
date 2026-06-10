import {z} from 'zod';
import {stepDtoSchema, stepErrorDtoSchema} from './step.js';

/**
 * Response of the runner-facing step pull. The job to progress is identified by
 * the caller's lease-token claims, never by the request itself. `done` reports
 * the job's terminal completion; an unknown job is a 404, not a `done`.
 */
export const nextStepResponseSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('step'),
    step: stepDtoSchema,
  }),
  z.object({
    kind: z.literal('done'),
    status: z.enum(['succeeded', 'failed']),
  }),
]);

export type NextStepResponseDto = z.infer<typeof nextStepResponseSchema>;

export const reportStepBodySchema = z.object({
  status: z.enum(['succeeded', 'failed']),
  error: stepErrorDtoSchema.optional(),
});

export type ReportStepBodyDto = z.infer<typeof reportStepBodySchema>;

/** `cancel` tells the agent to stop working on the job: it finished without full success. */
export const reportStepResponseSchema = z.object({
  ok: z.boolean(),
  cancel: z.boolean(),
});

export type ReportStepResponseDto = z.infer<typeof reportStepResponseSchema>;
