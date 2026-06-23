import {
  JOB_LEASE_TOKEN_AUDIENCE,
  type JobLeaseTokenClaims,
  jobLeaseTokenClaimsSchema,
} from '@shipfox/api-auth-dto';
import {signHs256, verifyHs256} from '@shipfox/node-jwt';
import {config} from '#config.js';
import {tokenIssuedCount, tokenVerifiedCount} from '#metrics/index.js';

// `aud`, `iat` and `exp` are set by the codec (jose); callers supply the business ids only.
export type IssueJobLeaseTokenParams = Omit<JobLeaseTokenClaims, 'aud' | 'iat' | 'exp'>;

export async function issueJobLeaseToken(claims: IssueJobLeaseTokenParams): Promise<string> {
  const token = await signHs256({
    payload: {
      jobId: claims.jobId,
      runId: claims.runId,
      projectId: claims.projectId,
      workspaceId: claims.workspaceId,
      runnerTokenId: claims.runnerTokenId,
    },
    secret: config.AUTH_JOB_LEASE_TOKEN_SECRET,
    expiresIn: config.AUTH_JOB_LEASE_TOKEN_EXPIRES_IN,
    audience: JOB_LEASE_TOKEN_AUDIENCE,
  });
  tokenIssuedCount.add(1, {token_type: 'job_lease'});
  return token;
}

/** Returns the claims on success, or `null` for any invalid input — never throws. */
export async function verifyJobLeaseToken(token: string): Promise<JobLeaseTokenClaims | null> {
  try {
    const claims = await verifyHs256({
      token,
      secret: config.AUTH_JOB_LEASE_TOKEN_SECRET,
      schema: jobLeaseTokenClaimsSchema,
      audience: JOB_LEASE_TOKEN_AUDIENCE,
    });
    tokenVerifiedCount.add(1, {token_type: 'job_lease', outcome: 'ok'});
    return claims;
  } catch {
    tokenVerifiedCount.add(1, {token_type: 'job_lease', outcome: 'rejected'});
    return null;
  }
}
