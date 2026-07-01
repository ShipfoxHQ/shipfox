import {
  type IntegrationConnection,
  toIntegrationConnectionDto as toCoreIntegrationConnectionDto,
} from '@shipfox/api-integration-core-dto';

export function toIntegrationConnectionDto(
  connection: IntegrationConnection<'gitea'>,
  options: {externalUrl?: string | undefined} = {},
) {
  return toCoreIntegrationConnectionDto(connection, {
    capabilities: ['source_control'],
    externalUrl: options.externalUrl,
  });
}
