import type {AuthInterModuleClient} from '@shipfox/api-auth-dto/inter-module';
import {mintLeaseToken} from './lease-token.js';

export const workflowsTestAuthClient: AuthInterModuleClient = {
  mintRunnerSessionToken() {
    throw new Error('Runner session token minting is not configured');
  },
  async mintJobLeaseToken(claims) {
    return {token: await mintLeaseToken(claims)};
  },
};
