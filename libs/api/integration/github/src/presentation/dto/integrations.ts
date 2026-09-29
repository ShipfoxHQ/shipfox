import type {GithubLinkSelectionResponseDto} from '@shipfox/api-integration-github-dto';
import type {IntegrationCapability, IntegrationConnection} from '@shipfox/api-integration-spi';
import type {GithubLinkSelection} from '#core/link.js';

export function toIntegrationConnectionDto(
  connection: IntegrationConnection<'github'>,
  options: {capabilities?: IntegrationCapability[]} = {},
) {
  return mapIntegrationConnection(connection, options.capabilities ?? ['source_control']);
}

function mapIntegrationConnection(
  connection: IntegrationConnection,
  capabilities: IntegrationCapability[],
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
    created_at: connection.createdAt.toISOString(),
    updated_at: connection.updatedAt.toISOString(),
  };
}

export function toGithubLinkSelectionDto(
  selection: GithubLinkSelection,
): GithubLinkSelectionResponseDto {
  return {
    candidates: selection.candidates.map((installation) => ({
      installation_id: installation.id,
      account_login: installation.account.login,
      account_type: installation.account.type,
      repository_selection: installation.repositorySelection,
    })),
    selection_token: selection.selectionToken,
  };
}
