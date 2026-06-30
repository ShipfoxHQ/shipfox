import {JOB_LEASE_TOKEN_AUDIENCE} from '@shipfox/api-auth-dto';
import {signHs256} from '@shipfox/node-jwt';
import {getFirstJobExecutionByJobId} from '#db/workflow-runs.js';

// Matches test/env.ts; the lease-token auth method reads this same value from config.
const SECRET = process.env.AUTH_JOB_LEASE_TOKEN_SECRET ?? 'test-lease-secret';

export interface MintLeaseTokenParams {
  jobId: string;
  jobExecutionId?: string;
  // Override informational claims to pair a job with chosen surrounding context.
  runId?: string;
  workflowRunAttemptId?: string;
  projectId?: string;
  workspaceId?: string;
  runnerSessionId?: string;
  secret?: string;
  expiresIn?: string;
  audience?: string;
}

export async function mintLeaseToken(params: MintLeaseTokenParams): Promise<string> {
  let jobExecutionId = params.jobExecutionId;
  if (jobExecutionId === undefined) {
    const jobExecution = await getFirstJobExecutionByJobId(params.jobId);
    if (!jobExecution) throw new Error('Expected job execution to exist');
    jobExecutionId = jobExecution.id;
  }

  return signHs256({
    payload: {
      jobId: params.jobId,
      jobExecutionId,
      workflowRunAttemptId: params.workflowRunAttemptId ?? params.runId ?? crypto.randomUUID(),
      projectId: params.projectId ?? crypto.randomUUID(),
      workspaceId: params.workspaceId ?? crypto.randomUUID(),
      runnerSessionId: params.runnerSessionId ?? crypto.randomUUID(),
    },
    secret: params.secret ?? SECRET,
    expiresIn: params.expiresIn ?? '90m',
    audience: params.audience ?? JOB_LEASE_TOKEN_AUDIENCE,
  });
}
