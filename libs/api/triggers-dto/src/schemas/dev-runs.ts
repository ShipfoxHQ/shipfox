import {definitionValidationWarningSchema} from '@shipfox/api-definitions-dto';
import {isSafeRefInput} from '@shipfox/regex';
import {z} from 'zod';

export const createDevRunBodySchema = z
  .object({
    project_id: z.string().uuid(),
    // A branch or tag name in the project repository. Raw commit SHAs and
    // pull-request refs are rejected by the ref resolution pipeline.
    ref: z
      .string()
      .min(1)
      .max(256)
      .refine(isSafeRefInput, 'Ref contains a control character')
      .optional(),
    // When supplied, the definitions module validates this YAML instead of
    // fetching the workflow file from the repository. The domain layer owns
    // the byte limit so callers receive `content-too-large`.
    content: z.string().optional(),
    // The commit the ref resolved to when the picker listed the file; a
    // mismatch answers 409 `ref-moved`.
    commit: z
      .string()
      .regex(/^[0-9a-f]{40}$/, 'Commit must be a 40-character hex sha')
      .optional(),
    config_path: z
      .string()
      .min(1)
      .max(1024)
      .refine(isSafeRefInput, 'Config path contains a control character'),
    // Trigger key in the resolved workflow file's `triggers` map.
    trigger: z.string().min(1),
    // Manual triggers only; rejected with `inputs-not-allowed` for cron and
    // integration triggers.
    inputs: z.record(z.string(), z.unknown()).optional(),
    // Integration triggers only; the journaled event to replay. Missing for an
    // integration source answers 422 `replay-event-required`.
    replay_event_id: z.string().uuid().optional(),
  })
  .superRefine(({content, ref, commit}, ctx) => {
    if (ref === undefined && content === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ref'],
        message: 'ref is required when content is not supplied',
      });
    }
    if (ref === undefined && commit !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['commit'],
        message: 'commit requires ref',
      });
    }
  })
  .strict();

export type CreateDevRunBodyDto = z.infer<typeof createDevRunBodySchema>;

export const createDevRunResponseSchema = z
  .object({
    workflow_run_id: z.string().uuid(),
    ref: z.string().optional(),
    commit: z.string(),
    warnings: z.array(definitionValidationWarningSchema).optional(),
  })
  .strict();

export type CreateDevRunResponseDto = z.infer<typeof createDevRunResponseSchema>;
