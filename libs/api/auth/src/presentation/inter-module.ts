import {authInterModuleContract} from '@shipfox/api-auth-dto/inter-module';
import {defineInterModulePresentation, type InterModulePresentation} from '@shipfox/inter-module';
import {issueJobLeaseToken} from '#core/job-lease-token.js';
import {issueRunnerSessionToken} from '#core/runner-session-token.js';

export function createAuthInterModulePresentation(): InterModulePresentation<
  typeof authInterModuleContract
> {
  return defineInterModulePresentation(authInterModuleContract, {
    mintRunnerSessionToken: async (claims) => ({token: await issueRunnerSessionToken(claims)}),
    mintJobLeaseToken: async (claims) => ({token: await issueJobLeaseToken(claims)}),
  });
}
