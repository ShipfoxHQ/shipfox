import {JOB_LEASE_TOKEN_AUDIENCE} from '@shipfox/api-auth-dto';
import {signHs256} from '@shipfox/node-jwt';

// Matches test/env.ts; the lease-token auth method reads this same value from config.
const SECRET = process.env.AUTH_JOB_LEASE_TOKEN_SECRET ?? 'test-lease-secret';

export interface MintLeaseTokenParams {
  jobId: string;
  // Override the informational claims to pair a job with a chosen (possibly
  // mismatched) run/project/workspace — used by the hostile-claims checkout test.
  runId?: string;
  projectId?: string;
  workspaceId?: string;
  secret?: string;
  expiresIn?: string;
  audience?: string;
}

export function mintLeaseToken(params: MintLeaseTokenParams): Promise<string> {
  return signHs256({
    payload: {
      jobId: params.jobId,
      runId: params.runId ?? crypto.randomUUID(),
      projectId: params.projectId ?? crypto.randomUUID(),
      workspaceId: params.workspaceId ?? crypto.randomUUID(),
      runnerSessionId: crypto.randomUUID(),
    },
    secret: params.secret ?? SECRET,
    expiresIn: params.expiresIn ?? '90m',
    audience: params.audience ?? JOB_LEASE_TOKEN_AUDIENCE,
  });
}
