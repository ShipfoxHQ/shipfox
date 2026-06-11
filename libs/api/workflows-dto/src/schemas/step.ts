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
