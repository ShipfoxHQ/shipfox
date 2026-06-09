import {
  JOB_LEASE_TOKEN_AUDIENCE,
  type JobLeaseTokenClaims,
  jobLeaseTokenClaimsSchema,
} from '@shipfox/api-runners-dto';
import {signHs256, verifyHs256} from '@shipfox/node-jwt';
import {config} from '#config.js';

// `aud`, `iat` and `exp` are set by the codec (jose); callers supply the business ids only.
export type IssueJobLeaseTokenParams = Omit<JobLeaseTokenClaims, 'aud' | 'iat' | 'exp'>;

export async function issueJobLeaseToken(claims: IssueJobLeaseTokenParams): Promise<string> {
  return await signHs256({
    payload: {
      jobId: claims.jobId,
      runId: claims.runId,
      workspaceId: claims.workspaceId,
      runnerTokenId: claims.runnerTokenId,
    },
    secret: config.RUNNERS_JOB_LEASE_TOKEN_SECRET,
    expiresIn: config.RUNNERS_JOB_LEASE_TOKEN_EXPIRES_IN,
    audience: JOB_LEASE_TOKEN_AUDIENCE,
  });
}

/** Returns the claims on success, or `null` for any invalid input — never throws. */
export async function verifyJobLeaseToken(token: string): Promise<JobLeaseTokenClaims | null> {
  try {
    return await verifyHs256({
      token,
      secret: config.RUNNERS_JOB_LEASE_TOKEN_SECRET,
      schema: jobLeaseTokenClaimsSchema,
      audience: JOB_LEASE_TOKEN_AUDIENCE,
    });
  } catch {
    return null;
  }
}
