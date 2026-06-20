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

  const webhook = await params.gitea.createOrgPushWebhook({org});
  try {
    return await params.connectGiteaConnection({
      workspaceId: params.workspaceId,
      org,
      displayName: `Gitea ${org}`,
      webhookId: webhook.id,
    });
  } catch (error) {
    // The webhook is an external side effect created before the persistence
    // transaction. If that transaction rolls back (a concurrent connect of the
    // same org won the ownership race, or a transient DB failure), delete the
    // hook we just created so it cannot deliver events with no backing
    // connection. Only a freshly created hook is removed; a reused one predates
    // this attempt. Cleanup is best-effort: the original error always wins.
    if (!webhook.reused) {
      await params.gitea.deleteOrgWebhook({org, webhookId: webhook.id}).catch(() => undefined);
    }
    throw error;
  }
}
