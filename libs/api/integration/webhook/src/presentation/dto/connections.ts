import type {IntegrationConnection} from '@shipfox/api-integration-core-dto';
import type {WebhookConnectionDto} from '@shipfox/api-integration-webhook-dto';

const TRAILING_SLASHES_RE = /\/+$/;

export function toWebhookConnectionDto(
  connection: IntegrationConnection,
  baseUrl: string,
): WebhookConnectionDto {
  return {
    id: connection.id,
    workspace_id: connection.workspaceId,
    name: connection.displayName,
    slug: connection.slug,
    lifecycle_status: connection.lifecycleStatus,
    inbound_url: `${baseUrl.replace(TRAILING_SLASHES_RE, '')}/webhook/${connection.id}`,
    created_at: connection.createdAt.toISOString(),
    updated_at: connection.updatedAt.toISOString(),
  };
}
