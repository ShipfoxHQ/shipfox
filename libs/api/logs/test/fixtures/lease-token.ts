import {JOB_LEASE_TOKEN_AUDIENCE} from '@shipfox/api-auth-dto';
import {signHs256} from '@shipfox/node-jwt';

// Matches test/env.ts; the lease-token auth method reads this same value from config.
const SECRET = process.env.AUTH_JOB_LEASE_TOKEN_SECRET ?? 'test-lease-secret';

export interface MintLeaseTokenParams {
  jobId: string;
  jobExecutionId: string;
  workspaceId?: string;
  projectId?: string;
  workflowRunId?: string;
  workflowRunAttemptId?: string;
  secret?: string;
  expiresIn?: string;
  audience?: string;
}

export function mintLeaseToken(params: MintLeaseTokenParams): Promise<string> {
  return signHs256({
    payload: {
      jobId: params.jobId,
      jobExecutionId: params.jobExecutionId,
      workflowRunId: params.workflowRunId ?? crypto.randomUUID(),
      workflowRunAttemptId: params.workflowRunAttemptId ?? crypto.randomUUID(),
      projectId: params.projectId ?? crypto.randomUUID(),
      workspaceId: params.workspaceId ?? crypto.randomUUID(),
      runnerSessionId: crypto.randomUUID(),
    },
    secret: params.secret ?? SECRET,
    expiresIn: params.expiresIn ?? '90m',
    audience: params.audience ?? JOB_LEASE_TOKEN_AUDIENCE,
  });
}
