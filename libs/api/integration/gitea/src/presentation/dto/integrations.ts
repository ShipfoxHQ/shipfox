import type {IntegrationConnection} from '@shipfox/api-integration-spi';

export function toIntegrationConnectionDto(
  connection: IntegrationConnection<'gitea'>,
  options: {externalUrl?: string | undefined} = {},
) {
  return mapIntegrationConnection(connection, ['source_control'], options.externalUrl);
}

function mapIntegrationConnection(
  connection: IntegrationConnection,
  capabilities: string[],
  externalUrl?: string,
) {
  return {
    id: connection.id,
    workspace_id: connection.workspaceId,
    provider: connection.provider,
    external_account_id: connection.externalAccountId,
    slug: connection.slug,
    display_name: connection.displayName,
    lifecycle_status: connection.lifecycleStatus,
    capabilities,
    ...(externalUrl ? {external_url: externalUrl} : {}),
    created_at: connection.createdAt.toISOString(),
    updated_at: connection.updatedAt.toISOString(),
  };
}
