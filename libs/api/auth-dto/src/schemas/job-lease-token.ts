import {z} from 'zod';

/**
 * Audience claim binding a token to the job-lease use case. Distinct from auth
 * tokens (separate secret) — this is defense-in-depth so the two token classes stay
 * non-interchangeable even if a verifier is ever misconfigured.
 */
export const JOB_LEASE_TOKEN_AUDIENCE = 'runner-job-lease';

export const jobLeaseTokenClaimsSchema = z.object({
  jobId: z.string().uuid(),
  runId: z.string().uuid(),
  projectId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  runnerSessionId: z.string().uuid(),
  aud: z.literal(JOB_LEASE_TOKEN_AUDIENCE),
  iat: z.number().int(),
  exp: z.number().int(),
});

export type JobLeaseTokenClaims = z.infer<typeof jobLeaseTokenClaimsSchema>;
