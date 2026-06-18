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
    attempt: z
      .number()
      .int()
      .positive()
      .describe(
        'Attempt number for this step dispatch. Echo it back when reporting the step result so stale reports from older attempts can be ignored.',
      ),
  }),
  z.object({
    kind: z.literal('done'),
    status: z
      .enum(['succeeded', 'failed'])
      .describe('Terminal status of the job when no step remains to run.'),
  }),
]);

export type NextStepResponseDto = z.infer<typeof nextStepResponseSchema>;

export const reportStepBodySchema = z
  .object({
    status: z.enum(['succeeded', 'failed']).describe('Final status reported for the step attempt.'),
    error: stepErrorDtoSchema
      .optional()
      .describe('Failure details. Required when status is failed.'),
    attempt: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'Attempt number echoed from next-step. Older runners may omit it; when present, it protects the workflow from stale reports.',
      ),
    exit_code: z
      .number()
      .int()
      .nullable()
      .optional()
      .describe(
        'Process exit code for the step attempt. Persisted as the canonical attempt exit code and used by gate evaluation.',
      ),
    output: z
      .record(z.string(), z.unknown())
      .nullable()
      .optional()
      .describe(
        'Structured output captured for attempt history. Large textual logs are stored separately.',
      ),
    log_stream_length: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe(
        'Final length in raw NDJSON bytes of the attempt log stream. The log module marks the stream complete once its committed length reaches this value, so the report never blocks on log drain.',
      ),
  })
  .refine((body) => (body.status === 'succeeded' ? body.error == null : body.error != null), {
    message: 'succeeded steps must not include an error and failed steps must include one',
  });

export type ReportStepBodyDto = z.infer<typeof reportStepBodySchema>;

export const reportStepResponseSchema = z.object({
  ok: z.boolean().describe('Whether the step report was accepted.'),
  cancel: z
    .boolean()
    .describe(
      'Whether the runner should stop working on the job because it finished without full success.',
    ),
});

export type ReportStepResponseDto = z.infer<typeof reportStepResponseSchema>;
