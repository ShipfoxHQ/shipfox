import {z} from 'zod';

export const RUNNER_JOB_LEASE_EXPIRED = 'runners.job.lease_expired' as const;
export const RUNNER_JOB_QUEUED = 'runners.job.queued' as const;
export const RUNNER_JOB_CLAIMED = 'runners.job.claimed' as const;

export const runnerJobLeaseExpiredEventSchema = z.object({
  jobId: z.string(),
  runId: z.string(),
});
export type RunnerJobLeaseExpiredEvent = z.infer<typeof runnerJobLeaseExpiredEventSchema>;

export const runnerJobQueuedEventSchema = z.object({
  jobId: z.string(),
  runId: z.string(),
  queuedAt: z.string(),
});
export type RunnerJobQueuedEvent = z.infer<typeof runnerJobQueuedEventSchema>;

export const runnerJobClaimedEventSchema = z.object({
  jobId: z.string(),
  runId: z.string(),
  claimedAt: z.string(),
});
export type RunnerJobClaimedEvent = z.infer<typeof runnerJobClaimedEventSchema>;

export interface RunnersEventMap {
  [RUNNER_JOB_LEASE_EXPIRED]: RunnerJobLeaseExpiredEvent;
  [RUNNER_JOB_QUEUED]: RunnerJobQueuedEvent;
  [RUNNER_JOB_CLAIMED]: RunnerJobClaimedEvent;
}

export const runnersEventSchemas = {
  [RUNNER_JOB_LEASE_EXPIRED]: runnerJobLeaseExpiredEventSchema,
  [RUNNER_JOB_QUEUED]: runnerJobQueuedEventSchema,
  [RUNNER_JOB_CLAIMED]: runnerJobClaimedEventSchema,
} satisfies Record<keyof RunnersEventMap, z.ZodType>;
