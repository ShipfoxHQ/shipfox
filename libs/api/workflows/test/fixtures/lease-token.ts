import {JOB_LEASE_TOKEN_AUDIENCE} from '@shipfox/api-auth-dto';
import {signHs256} from '@shipfox/node-jwt';

// Matches test/env.ts; the lease-token auth method reads this same value from config.
const SECRET = process.env.AUTH_JOB_LEASE_TOKEN_SECRET ?? 'test-lease-secret';

export interface MintLeaseTokenParams {
  jobId: string;
  secret?: string;
  expiresIn?: string;
  audience?: string;
}

/** Signs a job lease token the way Scheduling will, with overridable knobs for negative cases. */
export function mintLeaseToken(params: MintLeaseTokenParams): Promise<string> {
  return signHs256({
    payload: {
      jobId: params.jobId,
      runId: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      runnerTokenId: crypto.randomUUID(),
    },
    secret: params.secret ?? SECRET,
    expiresIn: params.expiresIn ?? '90m',
    audience: params.audience ?? JOB_LEASE_TOKEN_AUDIENCE,
  });
}
