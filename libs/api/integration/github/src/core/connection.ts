import type {UserContextMembership} from '@shipfox/api-auth-context';
import type {
  IntegrationConnection,
  IntegrationConnectionLifecycleStatus,
} from '@shipfox/api-integration-spi';
import type {GithubInstallationDetails} from '#api/client.js';
import {
  GithubInstallationAlreadyLinkedError,
  GithubInstallationNotAuthorizedError,
  GithubInstallStateActorMismatchError,
} from './errors.js';

export interface ConnectGithubInstallationInput {
  workspaceId: string;
  installationId: string;
  displayName: string;
  installerUserId: string;
  actorUserId?: string | undefined;
  lifecycleStatus?: IntegrationConnectionLifecycleStatus | undefined;
  installation: {
    installationId: string;
    accountLogin: string;
    accountType: string;
    repositorySelection: string;
    suspendedAt: Date | null;
    deletedAt: Date | null;
    latestEvent: Record<string, unknown>;
    installerUserId: string;
  };
}

export interface GithubInstallInteraction {
  kind: 'install';
  actorUserId: string;
  workspaceId: string;
  installationId: number;
}

export type GithubConnectionInteraction = GithubInstallInteraction;

export interface VerifiedGithubInstallation {
  installation: GithubInstallationDetails;
}

export interface ConnectGithubInteractionParams {
  interaction: GithubConnectionInteraction;
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
  acquireInstallationProof: (
    interaction: GithubConnectionInteraction,
  ) => Promise<VerifiedGithubInstallation>;
  connectGithubInstallation: (
    input: ConnectGithubInstallationInput,
  ) => Promise<IntegrationConnection<'github'>>;
}

export async function connectGithubInteraction(
  params: ConnectGithubInteractionParams,
): Promise<IntegrationConnection<'github'>> {
  const {interaction} = params;
  if (interaction.actorUserId !== params.sessionUserId) {
    throw new GithubInstallStateActorMismatchError();
  }
  await params.requireWorkspaceMembership({
    workspaceId: interaction.workspaceId,
    userId: interaction.actorUserId,
    memberships: params.sessionMemberships,
  });

  const installationId = String(interaction.installationId);
  const existing = await params.getExistingGithubConnection({installationId});
  if (existing && existing.workspaceId !== interaction.workspaceId) {
    throw new GithubInstallationAlreadyLinkedError(interaction.installationId);
  }
  if (existing && existing.lifecycleStatus === 'active') {
    return existing;
  }

  const proof = await params.acquireInstallationProof(interaction);
  if (proof.installation.id !== interaction.installationId) {
    throw new GithubInstallationNotAuthorizedError(interaction.installationId);
  }
  return await params.connectGithubInstallation({
    workspaceId: interaction.workspaceId,
    installationId,
    displayName: `GitHub ${proof.installation.account.login}`,
    installerUserId: interaction.actorUserId,
    actorUserId: interaction.actorUserId,
    installation: toConnectionInstallationInput(proof.installation, interaction.actorUserId),
  });
}

function toConnectionInstallationInput(
  installation: GithubInstallationDetails,
  installerUserId: string,
) {
  return {
    installationId: String(installation.id),
    accountLogin: installation.account.login,
    accountType: installation.account.type,
    repositorySelection: installation.repositorySelection,
    suspendedAt: installation.suspendedAt,
    deletedAt: null,
    latestEvent: installation.raw,
    installerUserId,
  };
}
