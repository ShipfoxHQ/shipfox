import type {IntegrationCapability, IntegrationConnection} from '@shipfox/api-integration-spi';

export function toIntegrationConnectionDto(
  connection: IntegrationConnection,
  options: {capabilities: IntegrationCapability[]},
) {
  return {
    id: connection.id,
    workspace_id: connection.workspaceId,
    provider: connection.provider,
    external_account_id: connection.externalAccountId,
    slug: connection.slug,
    display_name: connection.displayName,
    lifecycle_status: connection.lifecycleStatus,
    capabilities: options.capabilities,
    created_at: connection.createdAt.toISOString(),
    updated_at: connection.updatedAt.toISOString(),
  };
}
