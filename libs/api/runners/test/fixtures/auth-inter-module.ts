import {JOB_LEASE_TOKEN_AUDIENCE, RUNNER_SESSION_TOKEN_AUDIENCE} from '@shipfox/api-auth-dto';
import type {AuthInterModuleClient} from '@shipfox/api-auth-dto/inter-module';
import {jobLeaseTokenKey, runnerSessionTokenKey} from '@shipfox/node-auth-root-key';
import {signHs256} from '@shipfox/node-jwt';

const leaseSecret = jobLeaseTokenKey();
const runnerSessionSecret = runnerSessionTokenKey();

export const runnersTestAuthClient: AuthInterModuleClient = {
  async mintRunnerSessionToken(claims) {
    return {
      token: await signHs256({
        payload: claims,
        secret: runnerSessionSecret,
        expiresIn: '1h',
        audience: RUNNER_SESSION_TOKEN_AUDIENCE,
      }),
    };
  },
  async mintJobLeaseToken(claims) {
    return {
      token: await signHs256({
        payload: claims,
        secret: leaseSecret,
        expiresIn: '90m',
        audience: JOB_LEASE_TOKEN_AUDIENCE,
      }),
    };
  },
};
