import {policyNoticeSchema} from '@shipfox/policy-notice';
import {z} from 'zod';

const nonEmptyStringSchema = z.string().nonempty();
const isoDateTimeSchema = z.string().datetime();

export const RUNNER_JOB_LEASE_EXPIRED = 'runners.job.lease_expired' as const;
export const RUNNER_JOB_CLAIMED = 'runners.job.claimed' as const;
export const RUNNER_JOB_EXECUTION_PLACEMENT_DENIED =
  'runners.job_execution.placement_denied' as const;

const runnerProvisionerScopeSchema = z.enum(['installation', 'workspace']);
const runnerLaunchKindSchema = z.enum(['demand', 'warm', 'manual']);

export const runnerJobLossCauseSchema = z.enum([
  'lease_expired',
  'provider_lost',
  'lifecycle_violation',
  'runner_lost',
]);
export type RunnerJobLossCauseDto = z.infer<typeof runnerJobLossCauseSchema>;

export const runnerJobLeaseExpiredEventSchema = z.object({
  workflowRunId: nonEmptyStringSchema,
  workflowRunAttemptId: nonEmptyStringSchema,
  jobId: nonEmptyStringSchema,
  jobExecutionId: nonEmptyStringSchema,
  /**
   * Time when the reaper detected and removed the stale execution.
   * This is not the lease deadline.
   */
  expiredAt: isoDateTimeSchema.optional(),
  // Optional so consumers can continue to consume events written before bounded
  // runner-loss causes were published.
  cause: runnerJobLossCauseSchema.optional(),
});
export type RunnerJobLeaseExpiredEvent = z.infer<typeof runnerJobLeaseExpiredEventSchema>;

export const runnerJobClaimedEventSchema = z.object({
  workflowRunId: nonEmptyStringSchema,
  workflowRunAttemptId: nonEmptyStringSchema,
  jobId: nonEmptyStringSchema,
  jobExecutionId: nonEmptyStringSchema,
  claimedAt: isoDateTimeSchema,
  // Optional so subscribers can continue to consume events written before the fields existed.
  workspaceId: nonEmptyStringSchema.optional(),
  projectId: nonEmptyStringSchema.optional(),
  runnerLabels: z.array(nonEmptyStringSchema).min(1).optional(),
  templateKey: nonEmptyStringSchema.nullable().optional(),
  providerRunnerId: nonEmptyStringSchema.nullable().optional(),
  provisionerId: nonEmptyStringSchema.nullable().optional(),
  provisionerScope: runnerProvisionerScopeSchema.nullable().optional(),
  providerKind: nonEmptyStringSchema.nullable().optional(),
  launchKind: runnerLaunchKindSchema.nullable().optional(),
});
export type RunnerJobClaimedEvent = z.infer<typeof runnerJobClaimedEventSchema>;

export const runnerJobExecutionPlacementDeniedEventSchema = z.object({
  workspaceId: nonEmptyStringSchema,
  workflowRunId: nonEmptyStringSchema,
  workflowRunAttemptId: nonEmptyStringSchema,
  jobId: nonEmptyStringSchema,
  jobExecutionId: nonEmptyStringSchema,
  notice: policyNoticeSchema,
});
export type RunnerJobExecutionPlacementDeniedEvent = z.infer<
  typeof runnerJobExecutionPlacementDeniedEventSchema
>;

export interface RunnersEventMap {
  [RUNNER_JOB_LEASE_EXPIRED]: RunnerJobLeaseExpiredEvent;
  [RUNNER_JOB_CLAIMED]: RunnerJobClaimedEvent;
  [RUNNER_JOB_EXECUTION_PLACEMENT_DENIED]: RunnerJobExecutionPlacementDeniedEvent;
}

export const runnersEventSchemas = {
  [RUNNER_JOB_LEASE_EXPIRED]: runnerJobLeaseExpiredEventSchema,
  [RUNNER_JOB_CLAIMED]: runnerJobClaimedEventSchema,
  [RUNNER_JOB_EXECUTION_PLACEMENT_DENIED]: runnerJobExecutionPlacementDeniedEventSchema,
} satisfies Record<keyof RunnersEventMap, z.ZodType>;
