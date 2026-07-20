import {JOB_LEASE_TOKEN_AUDIENCE} from '@shipfox/api-auth-dto';
import type {AuthInterModuleClient} from '@shipfox/api-auth-dto/inter-module';
import {signHs256} from '@shipfox/node-jwt';

const leaseSecret = process.env.AUTH_JOB_LEASE_TOKEN_SECRET ?? 'test-lease-secret';

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
