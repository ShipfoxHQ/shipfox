import {z} from 'zod';
import {logOutcomeSchema} from './log-outcome.js';
import {stepDtoSchema, stepErrorDtoSchema} from './step.js';

export const STEP_RESPONSE_MAX_LENGTH = 8 * 1024;
export const STEP_LOG_PATH_MAX_BYTES = 1024;

const utf8Encoder = new TextEncoder();

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029
    );
  });
}

function runnerPathSchema(field: string) {
  return z
    .string()
    .min(1)
    .refine((value) => value.startsWith('/'), `${field} must be an absolute path`)
    .refine((value) => !hasControlCharacter(value), `${field} must not contain control characters`)
    .refine(
      (value) => utf8Encoder.encode(value).byteLength <= STEP_LOG_PATH_MAX_BYTES,
      `${field} must be at most ${STEP_LOG_PATH_MAX_BYTES} bytes`,
    );
}

const stepLogPathSchema = runnerPathSchema('log_path');

export const stepEnvSourceSchema = z.object({
  position: z.number().int().nonnegative().describe('Position of an earlier step in the job.'),
  attempt: z
    .number()
    .int()
    .positive()
    .describe('Attempt of that step that the runner executed and that still applies.'),
});

export type StepEnvSourceDto = z.infer<typeof stepEnvSourceSchema>;

/** The most step attempts a runner can hold at once, with room beyond the deployment limit. */
export const NEXT_STEP_IN_FLIGHT_MAX = 256;

export const inFlightStepSchema = z.object({
  step_id: z.string().uuid().describe('A step the runner is executing.'),
  attempt: z
    .number()
    .int()
    .positive()
    .describe('The attempt of that step the runner is executing.'),
});

export type InFlightStepDto = z.infer<typeof inFlightStepSchema>;

/**
 * The attempts the runner holds right now. The server hands a running step back to the runner
 * that does not list it, since the runner lost the response that delivered it, and it names the
 * listed attempts it wants stopped in `cancel_step_ids`. A runner that sends no body holds none.
 */
export const nextStepBodySchema = z
  .object({
    in_flight: z
      .array(inFlightStepSchema)
      .max(NEXT_STEP_IN_FLIGHT_MAX)
      .default([])
      .describe('The step attempts the runner is executing at this moment.'),
  })
  .nullish();

export type NextStepBodyDto = z.infer<typeof nextStepBodySchema>;

const cancelStepIdsSchema = z
  .array(z.string().uuid())
  .default([])
  .describe(
    'Steps the runner holds that a cancel step stopped. The runner terminates each one, finishes reading its files, and reports it as cancelled. Derived on every call, so a lost response loses nothing.',
  );

/**
 * The job to progress is identified by the caller's lease-token claims, never by
 * the request. An unknown job is a 404, not a `done`.
 */
export const nextStepResponseSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('step'),
    step: stepDtoSchema,
    background: z
      .boolean()
      .default(false)
      .describe(
        'True when the job moves on without waiting for this step. The runner pulls again right after starting any step.',
      ),
    cancel_step_ids: cancelStepIdsSchema,
    attempt: z
      .number()
      .int()
      .positive()
      .describe(
        'Attempt number for this step dispatch. Echo it back when reporting the step result so stale reports from older attempts can be ignored.',
      ),
    lease_token: z
      .string()
      .min(1)
      .describe(
        'Job-lease token re-scoped to this dispatched step attempt. The runner presents it as its lease for log-append authorization and carries it on later step requests.',
      ),
    env_sources: z
      .array(stepEnvSourceSchema)
      .optional()
      .describe(
        'Earlier steps, in position order, whose current attempt the runner executed. The runner applies the environment those attempts carried and drops the rest. Present on run, action and agent steps; skipped, pending, rewound and server-run steps are never listed.',
      ),
  }),
  z.object({
    kind: z.literal('wait'),
    retry_after_ms: z
      .number()
      .int()
      .positive()
      .describe(
        'Minimum delay before the runner polls for progress again. The runner polls sooner when one of its own steps ends.',
      ),
    cancel_step_ids: cancelStepIdsSchema,
  }),
  z.object({
    kind: z.literal('done'),
    status: z
      .enum(['succeeded', 'failed'])
      .describe('Terminal status of the job when no step remains to run.'),
    cancel_step_ids: cancelStepIdsSchema,
  }),
]);

export type NextStepResponseDto = z.infer<typeof nextStepResponseSchema>;

export const checkoutResultSchema = z
  .object({
    repository: z.string().min(1),
    ref: z.string().min(1),
    commit: z.string().min(1),
    path: z.string().min(1),
  })
  .describe('Resolved repository checkout details reported by the runner.');
export type CheckoutResultDto = z.infer<typeof checkoutResultSchema>;

export const reportStepBodySchema = z
  .object({
    status: z
      .enum(['succeeded', 'failed', 'cancelled'])
      .describe(
        'Final status reported for the step attempt. `cancelled` is valid only for an attempt that a cancel step is stopping, and confirms that its process has exited.',
      ),
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
    checkout: checkoutResultSchema
      .optional()
      .describe('Resolved repository checkout details captured for attempt history.'),
    log_path: stepLogPathSchema
      .optional()
      .describe(
        'Absolute path to the finalized plain-text log for this step attempt, when available.',
      ),
    actions_dir: runnerPathSchema('actions_dir')
      .optional()
      .describe(
        'Absolute path of the directory where the runner unpacks action bundles. Reported with the setup step.',
      ),
    response: z
      .string()
      .max(STEP_RESPONSE_MAX_LENGTH)
      .optional()
      .describe('Capped final assistant response for agent step attempts. Omitted for run steps.'),
    log_outcome: logOutcomeSchema.describe(
      'Whether the runner drained all locally spooled logs before reporting, or abandoned the log stream for backend closure.',
    ),
  })
  .refine((body) => (body.status === 'failed' ? body.error != null : body.error == null), {
    message: 'only failed steps include an error, and they must include one',
  })
  .refine((body) => body.status !== 'cancelled' || body.attempt !== undefined, {
    message: 'a cancelled report names the attempt it confirms',
    path: ['attempt'],
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
