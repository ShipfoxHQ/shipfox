import {toIntegrationConnectionDto as toCoreIntegrationConnectionDto} from '@shipfox/api-integration-core-dto';
import type {IntegrationConnection} from '#core/entities/connection.js';
import type {
  IntegrationCapability,
  RegisteredIntegrationProvider,
} from '#core/entities/provider.js';
import type {RepositorySnapshot} from '#core/providers/source-control.js';

export function toIntegrationProviderDto(provider: RegisteredIntegrationProvider) {
  return {
    provider: provider.provider,
    display_name: provider.displayName,
    capabilities: provider.capabilities,
  };
}

export function toIntegrationConnectionDto(
  connection: IntegrationConnection,
  options: {
    capabilities: IntegrationCapability[];
    externalUrl?: string | undefined;
  },
) {
  return toCoreIntegrationConnectionDto(connection, options);
}

export function toRepositoryDto(connectionId: string, repository: RepositorySnapshot) {
  return {
    connection_id: connectionId,
    external_repository_id: repository.externalRepositoryId,
    owner: repository.owner,
    name: repository.name,
    full_name: repository.fullName,
    default_branch: repository.defaultBranch,
    visibility: repository.visibility,
    clone_url: repository.cloneUrl,
    html_url: repository.htmlUrl,
  };
}
