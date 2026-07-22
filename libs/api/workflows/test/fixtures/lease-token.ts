import {AUTH_LEASED_JOB, setLeasedJobContext} from '@shipfox/api-auth-context';
import {JOB_LEASE_TOKEN_AUDIENCE, type JobLeaseTokenClaims} from '@shipfox/api-auth-dto';
import {type AuthMethod, ClientError, extractBearerToken} from '@shipfox/node-fastify';
import {getFirstJobExecutionByJobId} from '#db/workflow-runs.js';

const leaseClaims = new Map<string, JobLeaseTokenClaims>();

export interface MintLeaseTokenParams {
  jobId: string;
  jobExecutionId?: string;
  workflowRunId?: string;
  workflowRunAttemptId?: string;
  projectId?: string;
  workspaceId?: string;
  runnerSessionId?: string;
  currentStepId?: string | undefined;
  currentStepAttempt?: number | undefined;
}

export async function mintLeaseToken(params: MintLeaseTokenParams): Promise<string> {
  const jobExecution =
    params.jobExecutionId === undefined
      ? await getFirstJobExecutionByJobId(params.jobId)
      : undefined;
  const jobExecutionId = params.jobExecutionId ?? jobExecution?.id;
  if (!jobExecutionId) throw new Error('Expected job execution to exist');
  const token = `test-auth-${crypto.randomUUID()}`;
  leaseClaims.set(token, {
    jobId: params.jobId,
    jobExecutionId,
    workflowRunId: params.workflowRunId ?? crypto.randomUUID(),
    workflowRunAttemptId: params.workflowRunAttemptId ?? crypto.randomUUID(),
    projectId: params.projectId ?? crypto.randomUUID(),
    workspaceId: params.workspaceId ?? crypto.randomUUID(),
    runnerSessionId: params.runnerSessionId ?? crypto.randomUUID(),
    ...(params.currentStepId && params.currentStepAttempt !== undefined
      ? {currentStepId: params.currentStepId, currentStepAttempt: params.currentStepAttempt}
      : {}),
    aud: JOB_LEASE_TOKEN_AUDIENCE,
    iat: 0,
    exp: Number.MAX_SAFE_INTEGER,
  });
  return token;
}

export function getLeaseTokenClaims(token: string): JobLeaseTokenClaims | undefined {
  return leaseClaims.get(token);
}

export const fakeLeaseTokenAuthMethod: AuthMethod = {
  name: AUTH_LEASED_JOB,
  authenticate: (request) => {
    const token = extractBearerToken(request.headers.authorization);
    const claims = token ? leaseClaims.get(token) : undefined;
    if (!claims) throw new ClientError('Authentication required', 'unauthorized', {status: 401});
    setLeasedJobContext(request, claims);
    return Promise.resolve();
  },
};
