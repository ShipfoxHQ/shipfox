import type {IntegrationConnection} from '@shipfox/api-integration-core-dto';
import type {GiteaApiClient} from '#api/client.js';
import {GiteaOrgAlreadyLinkedError, GiteaOrganizationNotFoundError} from './errors.js';

export interface ConnectGiteaConnectionInput {
  workspaceId: string;
  org: string;
  displayName: string;
  webhookId: string;
}

export interface HandleGiteaConnectParams {
  gitea: GiteaApiClient;
  workspaceId: string;
  org: string;
  getExistingGiteaConnection: (input: {
    org: string;
  }) => Promise<IntegrationConnection<'gitea'> | undefined>;
  connectGiteaConnection: (
    input: ConnectGiteaConnectionInput,
  ) => Promise<IntegrationConnection<'gitea'>>;
}

export async function handleGiteaConnect(
  params: HandleGiteaConnectParams,
): Promise<IntegrationConnection<'gitea'>> {
  if (!(await params.gitea.organizationExists({org: params.org}))) {
    throw new GiteaOrganizationNotFoundError(params.org);
  }

  const existing = await params.getExistingGiteaConnection({org: params.org});
  if (existing && existing.workspaceId !== params.workspaceId) {
    throw new GiteaOrgAlreadyLinkedError(params.org);
  }
  // Re-connecting an org that is already active is a no-op: returning the
  // existing connection avoids registering a second webhook on every retry.
  if (existing && existing.lifecycleStatus === 'active') {
    return existing;
  }

  const webhook = await params.gitea.createOrgPushWebhook({org: params.org});
  return await params.connectGiteaConnection({
    workspaceId: params.workspaceId,
    org: params.org,
    displayName: `Gitea ${params.org}`,
    webhookId: webhook.id,
  });
}
