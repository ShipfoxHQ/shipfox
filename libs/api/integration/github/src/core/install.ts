import type {UserContextMembership} from '@shipfox/api-auth-context';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import type {GithubApiClient} from '#api/client.js';
import {
  type ConnectGithubInstallationInput,
  connectGithubInteraction,
  type GithubConnectionInteraction,
  type VerifiedGithubInstallation,
} from './connection.js';
import {GithubInstallationNotAuthorizedError} from './errors.js';
import {verifyGithubInstallState} from './state.js';

export interface HandleGithubCallbackParams {
  github: GithubApiClient;
  code: string;
  installationId: number;
  state: string;
  sessionUserId: string;
  sessionMemberships: ReadonlyArray<UserContextMembership>;
  requireWorkspaceMembership: (params: {
    workspaceId: string;
    userId: string;
    memberships: ReadonlyArray<UserContextMembership>;
  }) => Promise<unknown>;
  getExistingGithubConnection: (input: {
    installationId: string;
  }) => Promise<IntegrationConnection<'github'> | undefined>;
  connectGithubInstallation: (
    input: ConnectGithubInstallationInput,
  ) => Promise<IntegrationConnection<'github'>>;
}

export async function handleGithubCallback(
  params: HandleGithubCallbackParams,
): Promise<IntegrationConnection<'github'>> {
  const claims = verifyGithubInstallState(params.state);
  const interaction: GithubConnectionInteraction = {
    kind: 'install',
    actorUserId: claims.userId,
    workspaceId: claims.workspaceId,
    installationId: params.installationId,
  };

  return await connectGithubInteraction({
    interaction,
    sessionUserId: params.sessionUserId,
    sessionMemberships: params.sessionMemberships,
    requireWorkspaceMembership: params.requireWorkspaceMembership,
    getExistingGithubConnection: params.getExistingGithubConnection,
    acquireInstallationProof: async (verifiedInteraction) =>
      await acquireGithubInstallProof({
        github: params.github,
        code: params.code,
        interaction: verifiedInteraction,
      }),
    connectGithubInstallation: params.connectGithubInstallation,
  });
}

async function acquireGithubInstallProof(params: {
  github: GithubApiClient;
  code: string;
  interaction: GithubConnectionInteraction;
}): Promise<VerifiedGithubInstallation> {
  const userAccessToken = await params.github.exchangeOAuthCode(params.code);
  const accessible = await userCanAccessInstallation({
    github: params.github,
    userAccessToken,
    installationId: params.interaction.installationId,
  });
  if (!accessible) {
    throw new GithubInstallationNotAuthorizedError(params.interaction.installationId);
  }

  return {
    installation: await params.github.getInstallation(params.interaction.installationId),
  };
}

async function userCanAccessInstallation(params: {
  github: GithubApiClient;
  userAccessToken: string;
  installationId: number;
}): Promise<boolean> {
  let cursor: string | undefined;
  do {
    const page = await params.github.listUserInstallations({
      userAccessToken: params.userAccessToken,
      cursor,
    });
    if (page.installationIds.includes(params.installationId)) return true;
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return false;
}
