import {
  createGithubToolClient,
  GithubAgentToolsProvider,
  type GithubInstallation,
} from '@shipfox/api-integration-github';
import type {GithubContractAccess} from '../fakes/github.js';

/** The GitHub tool adapter, with the fake's installation in place of the database and the app. */
export function githubContractTools(access: GithubContractAccess): GithubAgentToolsProvider {
  const now = new Date();
  const installation: GithubInstallation = {
    id: `contracts-${access.installationId}`,
    connectionId: `contracts-${access.installationId}`,
    installationId: String(access.installationId),
    accountLogin: 'contracts',
    accountType: 'Organization',
    accountId: null,
    repositorySelection: 'all',
    suspendedAt: null,
    deletedAt: null,
    latestEvent: {},
    installerUserId: null,
    createdAt: now,
    updatedAt: now,
  };
  return new GithubAgentToolsProvider({
    getInstallationByConnectionId: () => Promise.resolve(installation),
    tokenProvider: {
      getInstallationAccessToken: () =>
        Promise.resolve({
          token: access.installationToken,
          expiresAt: new Date(Date.now() + 3_600_000),
        }),
    },
    // The fake has no rate limit, so Octokit's spacing between writes would only slow the suite.
    createClient: (token) => createGithubToolClient({token, throttle: false}),
  });
}
