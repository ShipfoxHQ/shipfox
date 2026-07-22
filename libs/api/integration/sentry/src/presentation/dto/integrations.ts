import type {IntegrationConnection} from '@shipfox/api-integration-spi';

// Sentry exposes no adapters, so its connections carry no capabilities.
export function toIntegrationConnectionDto(connection: IntegrationConnection<'sentry'>) {
  return {
    id: connection.id,
    workspace_id: connection.workspaceId,
    provider: connection.provider,
    external_account_id: connection.externalAccountId,
    slug: connection.slug,
    display_name: connection.displayName,
    lifecycle_status: connection.lifecycleStatus,
    capabilities: [],
    created_at: connection.createdAt.toISOString(),
    updated_at: connection.updatedAt.toISOString(),
  };
}
