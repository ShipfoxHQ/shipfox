import {
  type IntegrationConnection,
  toIntegrationConnectionDto as toCoreIntegrationConnectionDto,
} from '@shipfox/api-integration-core-dto';

export function toIntegrationConnectionDto(connection: IntegrationConnection<'github'>) {
  return toCoreIntegrationConnectionDto(connection, {capabilities: ['source_control']});
}
