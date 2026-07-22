import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import type {GiteaApiClient} from '#api/client.js';
import {GiteaOrgAlreadyLinkedError, GiteaOrganizationNotFoundError} from './errors.js';

export interface ConnectGiteaConnectionInput {
  workspaceId: string;
  org: string;
  displayName: string;
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
  if (existing && existing.lifecycleStatus === 'active') {
    return existing;
  }

  // The read-only service account cannot manage org hooks; the instance admin
  // provisions push delivery out of band.
  return await params.connectGiteaConnection({
    workspaceId: params.workspaceId,
    org,
    displayName: `Gitea ${org}`,
  });
}
