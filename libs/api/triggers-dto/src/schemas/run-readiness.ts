import {secretKeySchema} from '@shipfox/api-secrets-dto';
import {agentConfigInvalidReasonSchema} from '@shipfox/api-workflows-dto';
import {z} from 'zod';

/** Matches the definitions list page limit. */
export const RUN_READINESS_DEFINITION_IDS_MAX = 100;

// A single `definition_id` arrives as a string, repeated ones as an array.
const definitionIdsSchema = z.preprocess(
  (value) => (value === undefined || Array.isArray(value) ? value : [value]),
  z.array(z.string().uuid()).min(1).max(RUN_READINESS_DEFINITION_IDS_MAX),
);

export const runReadinessQuerySchema = z.object({
  project_id: z.string().uuid(),
  definition_id: definitionIdsSchema,
});
export type RunReadinessQueryDto = z.infer<typeof runReadinessQuerySchema>;

const runIssueStepSchema = z.object({
  key: z.string().optional(),
  name: z.string().optional(),
  /** 1-based position among the job's authored steps. */
  index: z.number().int().positive(),
});

const runIssueLocationSchema = z.object({
  job_key: z.string().optional(),
  step: runIssueStepSchema.optional(),
  field: z.string(),
  env_key: z.string().optional(),
});
export type RunIssueLocationDto = z.infer<typeof runIssueLocationSchema>;

/**
 * What an issue does when a run happens: `blocks-start` refuses the run, `fails-job` lets it
 * start and fails a job later.
 */
export const runIssueEffectSchema = z.enum(['blocks-start', 'fails-job']);
export type RunIssueEffectDto = z.infer<typeof runIssueEffectSchema>;

export const runIssueDtoSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('variable-missing'),
    key: z.string(),
    locations: z.array(runIssueLocationSchema),
    more_locations: z.number().int().positive().optional(),
    effect: runIssueEffectSchema,
  }),
  z.object({
    kind: z.literal('secret-missing'),
    key: secretKeySchema,
    locations: z.array(runIssueLocationSchema),
    more_locations: z.number().int().positive().optional(),
    effect: runIssueEffectSchema,
  }),
  z.object({
    kind: z.literal('agent-config-invalid'),
    reason: agentConfigInvalidReasonSchema,
    model: z.string().optional(),
    provider: z.string().optional(),
    locations: z.array(runIssueLocationSchema),
    more_locations: z.number().int().positive().optional(),
    effect: runIssueEffectSchema,
  }),
]);
export type RunIssueDto = z.infer<typeof runIssueDtoSchema>;

export const runReadinessResponseSchema = z.object({
  definitions: z.array(
    z.object({
      definition_id: z.string().uuid(),
      issues: z.array(runIssueDtoSchema),
    }),
  ),
});
export type RunReadinessResponseDto = z.infer<typeof runReadinessResponseSchema>;
