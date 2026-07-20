import {JOB_LEASE_TOKEN_AUDIENCE} from '@shipfox/api-auth-dto';
import type {AuthInterModuleClient} from '@shipfox/api-auth-dto/inter-module';
import {jobLeaseTokenKey} from '@shipfox/node-auth-root-key';
import {signHs256} from '@shipfox/node-jwt';

const leaseSecret = jobLeaseTokenKey();

export const workflowsTestAuthClient: AuthInterModuleClient = {
  mintRunnerSessionToken() {
    throw new Error('Runner session token minting is not configured');
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
