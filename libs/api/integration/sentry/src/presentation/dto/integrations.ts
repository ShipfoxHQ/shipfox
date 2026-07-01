import {
  type IntegrationConnection,
  toIntegrationConnectionDto as toCoreIntegrationConnectionDto,
} from '@shipfox/api-integration-core-dto';

// Sentry exposes no adapters, so its connections carry no capabilities.
export function toIntegrationConnectionDto(connection: IntegrationConnection<'sentry'>) {
  return toCoreIntegrationConnectionDto(connection, {capabilities: []});
}
