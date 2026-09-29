import type {UserContextMembership} from '@shipfox/api-auth-context';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import type {GithubApiClient} from '#api/client.js';
import {
  authorizeGithubInteraction,
  type ConnectGithubInteractionParams,
  connectAuthorizedGithubInteraction,
  type GithubConnectionInteraction,
} from './connection.js';
import {
  GithubLinkStateActorMismatchError,
  GithubMultipleLinkableInstallationsError,
  GithubNoLinkableInstallationError,
} from './errors.js';
import {verifyGithubLinkState} from './state.js';

export interface HandleGithubLinkCallbackParams {
  github: GithubApiClient;
  code: string;
  state: string;
  sessionUserId: string;
  sessionMemberships: ReadonlyArray<UserContextMembership>;
  requireWorkspaceMembership: ConnectGithubInteractionParams['requireWorkspaceMembership'];
  getExistingGithubConnection: ConnectGithubInteractionParams['getExistingGithubConnection'];
  connectGithubInstallation: ConnectGithubInteractionParams['connectGithubInstallation'];
}

export async function handleGithubLinkCallback(
  params: HandleGithubLinkCallbackParams,
): Promise<IntegrationConnection<'github'>> {
  const claims = verifyGithubLinkState(params.state);
  if (claims.userId !== params.sessionUserId) {
    throw new GithubLinkStateActorMismatchError();
  }

  const authorization = {
    actorUserId: claims.userId,
    workspaceId: claims.workspaceId,
  } satisfies Pick<GithubConnectionInteraction, 'actorUserId' | 'workspaceId'>;
  await authorizeGithubInteraction({
    interaction: authorization,
    sessionUserId: params.sessionUserId,
    sessionMemberships: params.sessionMemberships,
    requireWorkspaceMembership: params.requireWorkspaceMembership,
  });

  let userAccessToken = await params.github.exchangeOAuthCode(params.code, claims.codeVerifier);
  try {
    const result = await findLinkableInstallation({
      github: params.github,
      userAccessToken,
      workspaceId: claims.workspaceId,
      getExistingGithubConnection: params.getExistingGithubConnection,
    });

    if (result.existingConnection) return result.existingConnection;
    if (result.candidateIds.length === 0) {
      throw new GithubNoLinkableInstallationError(result.accessible, result.linkedElsewhere);
    }
    if (result.candidateIds.length > 1) {
      throw new GithubMultipleLinkableInstallationsError(result.candidateIds.length);
    }

    const interaction: GithubConnectionInteraction = {
      kind: 'link',
      actorUserId: claims.userId,
      workspaceId: claims.workspaceId,
      installationId: result.candidateIds[0] as number,
    };
    return await connectAuthorizedGithubInteraction({
      interaction,
      sessionUserId: params.sessionUserId,
      sessionMemberships: params.sessionMemberships,
      requireWorkspaceMembership: params.requireWorkspaceMembership,
      getExistingGithubConnection: params.getExistingGithubConnection,
      acquireInstallationProof: async () => ({
        installation: await params.github.getInstallation(interaction.installationId),
      }),
      connectGithubInstallation: params.connectGithubInstallation,
    });
  } finally {
    userAccessToken = '';
  }
}

async function findLinkableInstallation(params: {
  github: GithubApiClient;
  userAccessToken: string;
  workspaceId: string;
  getExistingGithubConnection: ConnectGithubInteractionParams['getExistingGithubConnection'];
}): Promise<{
  accessible: number;
  linkedElsewhere: number;
  candidateIds: number[];
  existingConnection?: IntegrationConnection<'github'>;
}> {
  let cursor: string | undefined;
  let accessible = 0;
  let linkedElsewhere = 0;
  let existingConnection: IntegrationConnection<'github'> | undefined;
  const candidateIds: number[] = [];

  do {
    const page = await params.github.listUserInstallations({
      userAccessToken: params.userAccessToken,
      cursor,
    });
    accessible += page.installationIds.length;
    for (const installationId of page.installationIds) {
      const existing = await params.getExistingGithubConnection({
        installationId: String(installationId),
      });
      if (!existing) {
        candidateIds.push(installationId);
        continue;
      }
      if (existing.workspaceId === params.workspaceId) {
        existingConnection ??= existing;
      } else {
        linkedElsewhere += 1;
      }
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);

  return {
    accessible,
    linkedElsewhere,
    candidateIds,
    ...(existingConnection ? {existingConnection} : {}),
  };
}
