import type {IntegrationCapability, IntegrationConnection} from '@shipfox/api-integration-core-dto';
import {toIntegrationConnectionDto as toCoreIntegrationConnectionDto} from '@shipfox/api-integration-core-dto';

export function toIntegrationConnectionDto(
  connection: IntegrationConnection,
  params: {capabilities: IntegrationCapability[]},
) {
  return toCoreIntegrationConnectionDto(connection, params);
}
