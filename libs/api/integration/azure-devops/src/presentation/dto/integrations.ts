import type {IntegrationCapabilityDto} from '@shipfox/api-integration-core-dto';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';

export function toIntegrationConnectionDto(
  connection: IntegrationConnection<'azure-devops'>,
  options: {capabilities: IntegrationCapabilityDto[]; externalUrl?: string | undefined},
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
    ...(options.externalUrl ? {external_url: options.externalUrl} : {}),
    created_at: connection.createdAt.toISOString(),
    updated_at: connection.updatedAt.toISOString(),
  };
}
