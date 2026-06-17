import {z} from 'zod';

// Machine-readable cause of a setup-phase failure, for DB troubleshooting. The
// runner reports it and the server stores it as-is. The runner currently emits
// `workspace_prep_failed`; the `checkout_*`, `git_unavailable`, and `setup_aborted`
// values complete the taxonomy the read path accepts.
export const stepErrorReasonSchema = z.enum([
  'checkout_failed',
  'checkout_auth_failed',
  'checkout_unavailable',
  'git_unavailable',
  'workspace_prep_failed',
  'setup_aborted',
]);

export type StepErrorReason = z.infer<typeof stepErrorReasonSchema>;

// Whether a failure is infrastructure (`setup`) or user-code (`user`). Server-derived
// from the step's type on the read path; the runner never sends it.
export const stepErrorCategorySchema = z.enum(['setup', 'user']);

export type StepErrorCategory = z.infer<typeof stepErrorCategorySchema>;

export const stepErrorDtoSchema = z
  .object({
    message: z.string(),
    exit_code: z.number().int().nullable().optional(),
    signal: z.string().optional(),
    reason: stepErrorReasonSchema.optional(),
    category: stepErrorCategorySchema.optional(),
  })
  .nullable();

export type StepErrorDtoShape = z.infer<typeof stepErrorDtoSchema>;

export const stepSourceLocationSchema = z
  .object({
    start_line: z.number().int().positive(),
    end_line: z.number().int().positive(),
  })
  .refine((value) => value.end_line >= value.start_line, {
    message: 'end_line must be greater than or equal to start_line',
    path: ['end_line'],
  });

export type StepSourceLocationDto = z.infer<typeof stepSourceLocationSchema>;

export const stepDtoSchema = z.object({
  id: z.string().uuid(),
  job_id: z.string().uuid(),
  name: z.string().nullable(),
  source_location: stepSourceLocationSchema.nullable(),
  status: z.string(),
  type: z.string(),
  config: z.record(z.string(), z.unknown()),
  error: stepErrorDtoSchema,
  position: z.number(),
  // Execution-attempt identity of the current projection (>1 after a restart).
  current_attempt: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type StepDto = z.infer<typeof stepDtoSchema>;

// One execution attempt of a step (the durable history behind the current
// projection). Surfaced in run details so a restarted step's attempts are visible.
export const stepAttemptDtoSchema = z.object({
  id: z.string().uuid(),
  step_id: z.string().uuid(),
  job_id: z.string().uuid(),
  attempt: z.number().int().positive(),
  status: z.string(),
  exit_code: z.number().int().nullable(),
  // `output`, `error`, and `gate_result` are opaque audit blobs: the raw jsonb
  // persisted for the attempt, NOT snake_case-normalized (their nested keys may
  // be camelCase, e.g. `error.exitCode`). Consume the top-level snake_case
  // `exit_code` for the numeric code; treat these as display/debug payloads.
  output: z.record(z.string(), z.unknown()).nullable(),
  error: z.record(z.string(), z.unknown()).nullable(),
  gate_result: z.record(z.string(), z.unknown()).nullable(),
  restart_reason: z.string().nullable(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
});

export type StepAttemptDto = z.infer<typeof stepAttemptDtoSchema>;
