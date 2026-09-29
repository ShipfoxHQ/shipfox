import type {UserContextMembership} from '@shipfox/api-auth-context';
import {GITHUB_LINK_SELECTION_MAX_CANDIDATES} from '@shipfox/api-integration-github-dto';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import type {GithubApiClient, GithubUserInstallation} from '#api/client.js';
import {
  authorizeGithubInteraction,
  type ConnectGithubInteractionParams,
  connectAuthorizedGithubInteraction,
  connectGithubInteraction,
  type GithubConnectionInteraction,
} from './connection.js';
import {
  GithubInstallationNotAuthorizedError,
  GithubInstallationSuspendedError,
  GithubLinkStateActorMismatchError,
  GithubNoLinkableInstallationError,
  GithubTooManyLinkableInstallationsError,
} from './errors.js';
import {
  signGithubLinkSelection,
  verifyGithubLinkSelection,
  verifyGithubLinkState,
} from './state.js';

export interface GithubLinkSelection {
  candidates: GithubUserInstallation[];
  selectionToken: string;
}

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
): Promise<IntegrationConnection<'github'> | GithubLinkSelection> {
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
    if (result.candidates.length === 0) {
      throw new GithubNoLinkableInstallationError(result.accessible, result.linkedElsewhere);
    }
    if (result.candidates.length > GITHUB_LINK_SELECTION_MAX_CANDIDATES) {
      throw new GithubTooManyLinkableInstallationsError(result.candidates.length);
    }
    if (result.candidates.length > 1) {
      return {
        candidates: result.candidates,
        selectionToken: signGithubLinkSelection({
          workspaceId: claims.workspaceId,
          userId: claims.userId,
          installationIds: result.candidates.map(({id}) => id),
        }),
      };
    }

    const interaction: GithubConnectionInteraction = {
      kind: 'link',
      actorUserId: claims.userId,
      workspaceId: claims.workspaceId,
      installationId: (result.candidates[0] as GithubUserInstallation).id,
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

export interface HandleGithubLinkSelectionParams {
  github: GithubApiClient;
  selectionToken: string;
  installationId: number;
  sessionUserId: string;
  sessionMemberships: ReadonlyArray<UserContextMembership>;
  requireWorkspaceMembership: ConnectGithubInteractionParams['requireWorkspaceMembership'];
  getExistingGithubConnection: ConnectGithubInteractionParams['getExistingGithubConnection'];
  connectGithubInstallation: ConnectGithubInteractionParams['connectGithubInstallation'];
  now?: Date | undefined;
}

/**
 * Links one installation from a selection token. GitHub user access is not
 * rechecked: the token is the proof, and it can be up to five minutes stale.
 */
export async function handleGithubLinkSelection(
  params: HandleGithubLinkSelectionParams,
): Promise<IntegrationConnection<'github'>> {
  const claims = verifyGithubLinkSelection(params.selectionToken, params.now);
  if (claims.userId !== params.sessionUserId) {
    throw new GithubLinkStateActorMismatchError();
  }
  if (!claims.installationIds.includes(params.installationId)) {
    throw new GithubInstallationNotAuthorizedError(params.installationId);
  }

  return await connectGithubInteraction({
    interaction: {
      kind: 'link',
      actorUserId: claims.userId,
      workspaceId: claims.workspaceId,
      installationId: params.installationId,
    },
    sessionUserId: params.sessionUserId,
    sessionMemberships: params.sessionMemberships,
    requireWorkspaceMembership: params.requireWorkspaceMembership,
    getExistingGithubConnection: params.getExistingGithubConnection,
    acquireInstallationProof: async ({installationId}) => {
      const installation = await params.github.getInstallation(installationId);
      if (installation.suspendedAt) throw new GithubInstallationSuspendedError(installationId);
      return {installation};
    },
    connectGithubInstallation: params.connectGithubInstallation,
  });
}

async function findLinkableInstallation(params: {
  github: GithubApiClient;
  userAccessToken: string;
  workspaceId: string;
  getExistingGithubConnection: ConnectGithubInteractionParams['getExistingGithubConnection'];
}): Promise<{
  accessible: number;
  linkedElsewhere: number;
  candidates: GithubUserInstallation[];
  existingConnection?: IntegrationConnection<'github'>;
}> {
  let cursor: string | undefined;
  let accessible = 0;
  let linkedElsewhere = 0;
  let existingConnection: IntegrationConnection<'github'> | undefined;
  const candidates: GithubUserInstallation[] = [];

  do {
    const page = await params.github.listUserInstallations({
      userAccessToken: params.userAccessToken,
      cursor,
    });
    accessible += page.installations.length;
    for (const installation of page.installations) {
      const existing = await params.getExistingGithubConnection({
        installationId: String(installation.id),
      });
      if (!existing) {
        candidates.push(installation);
        continue;
      }
      if (existing.workspaceId !== params.workspaceId) {
        linkedElsewhere += 1;
        continue;
      }
      if (existing.lifecycleStatus === 'active') {
        existingConnection ??= existing;
        continue;
      }
      candidates.push(installation);
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);

  return {
    accessible,
    linkedElsewhere,
    candidates,
    ...(existingConnection ? {existingConnection} : {}),
  };
}
