import {z} from 'zod';

export const RUNNER_SESSION_EXHAUSTED_CODE = 'runner-session-exhausted' as const;

export const claimedJobResponseSchema = z.object({
  job_id: z.string().uuid(),
  job_execution_id: z.string().uuid(),
  run_id: z.string().uuid(),
  lease_token: z.string().min(1),
});

export type ClaimedJobResponseDto = z.infer<typeof claimedJobResponseSchema>;
