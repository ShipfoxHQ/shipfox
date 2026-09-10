import type {AuthInterModuleClient} from '@shipfox/api-auth-dto/inter-module';
import {mintLeaseToken} from './lease-token.js';

export const workflowsTestAuthClient: AuthInterModuleClient = {
  mintRunnerSessionToken() {
    throw new Error('Runner session token minting is not configured');
  },
  async mintJobLeaseToken(claims) {
    return {token: await mintLeaseToken(claims)};
  },
  mintAgentLogDownloadToken() {
    return Promise.resolve({token: 'test-download-token', expiresAt: new Date().toISOString()});
  },
  checkAgentGrantAuthority() {
    return Promise.resolve({ok: true as const});
  },
  getCurrentAdminRole() {
    return Promise.resolve({role: null});
  },
  requireAdminRole() {
    return Promise.reject(
      new Error('Administrator role checks are not configured in workflow tests'),
    );
  },
  listImpersonationEligibleUserSummaries() {
    return Promise.reject(
      new Error('Impersonation eligibility is not configured in workflow tests'),
    );
  },
};
