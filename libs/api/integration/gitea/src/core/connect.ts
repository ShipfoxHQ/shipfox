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
  // Gitea resolves org names case-insensitively, but the ownership lookup and the
  // unique indexes that back the cross-tenant guard compare the stored `org`
  // case-sensitively. Canonicalize once here so a case variant ("Acme" vs "acme")
  // cannot slip past getExistingGiteaConnection and link an org another workspace
  // already owns. The source-control scope guard already lowercases both sides.
  const org = params.org.toLowerCase();

  if (!(await params.gitea.organizationExists({org}))) {
    throw new GiteaOrganizationNotFoundError(org);
  }

  const existing = await params.getExistingGiteaConnection({org});
  if (existing && existing.workspaceId !== params.workspaceId) {
    throw new GiteaOrgAlreadyLinkedError(org);
  }
  // Re-connecting an org that is already active is a no-op: returning the
  // existing connection avoids registering a second webhook on every retry.
  if (existing && existing.lifecycleStatus === 'active') {
    return existing;
  }

  // Webhook registration is idempotent: createOrgPushWebhook reuses an existing
  // active push hook for this org. If the persistence below rolls back (a
  // concurrent connect won the ownership race, or a transient DB failure), the
  // hook is left in place and re-adopted by the next connect instead of being
  // deleted. Deleting it here would risk removing a hook a concurrent successful
  // connect just adopted, and until adoption it only delivers events that the
  // receiver ignores for an org with no connection.
  const webhook = await params.gitea.createOrgPushWebhook({org});
  return await params.connectGiteaConnection({
    workspaceId: params.workspaceId,
    org,
    displayName: `Gitea ${org}`,
    webhookId: webhook.id,
  });
}
