import {JOB_LEASE_TOKEN_AUDIENCE} from '@shipfox/api-auth-dto';
import {signHs256} from '@shipfox/node-jwt';

const SECRET = process.env.AUTH_JOB_LEASE_TOKEN_SECRET ?? 'test-lease-secret';

export interface MintLeaseTokenParams {
  jobId: string;
  jobExecutionId: string;
  workspaceId?: string;
  projectId?: string;
  workflowRunId?: string;
  workflowRunAttempt?: number;
  workflowRunAttemptId?: string;
  currentStepId?: string;
  currentStepAttempt?: number;
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
      workflowRunAttempt: params.workflowRunAttempt ?? 1,
      workflowRunAttemptId: params.workflowRunAttemptId ?? crypto.randomUUID(),
      projectId: params.projectId ?? crypto.randomUUID(),
      workspaceId: params.workspaceId ?? crypto.randomUUID(),
      runnerSessionId: crypto.randomUUID(),
      ...(params.currentStepId && params.currentStepAttempt !== undefined
        ? {
            currentStepId: params.currentStepId,
            currentStepAttempt: params.currentStepAttempt,
          }
        : {}),
    },
    secret: params.secret ?? SECRET,
    expiresIn: params.expiresIn ?? '90m',
    audience: params.audience ?? JOB_LEASE_TOKEN_AUDIENCE,
  });
}
