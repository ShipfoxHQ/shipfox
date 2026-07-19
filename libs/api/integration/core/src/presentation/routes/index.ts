import type {RouteExport} from '@shipfox/node-fastify';
import type {IntegrationProviderRegistry} from '#core/providers/registry.js';
import type {IntegrationSourceControlService} from '#core/source-control-service.js';
import type {GetIntegrationConnectionByIdFn} from '#db/connections.js';
import {
  createAgentToolsGatewayRoutes,
  type LeasedAgentStepLoader,
} from './agent-tools-gateway/index.js';
import {createListIntegrationConnectionsRoute} from './list-connections.js';
import {createListIntegrationProvidersRoute} from './list-providers.js';
import {createListRepositoriesRoute} from './list-repositories.js';
import {
  createDeleteIntegrationConnectionRoute,
  createUpdateIntegrationConnectionRoute,
} from './manage-connections.js';

export type {LeasedAgentStepLoader} from './agent-tools-gateway/index.js';

export interface CreateIntegrationRoutesOptions {
  agentTools?:
    | {
        loadLeasedAgentStep: LeasedAgentStepLoader;
        getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
      }
    | undefined;
}

export function createIntegrationRoutes(
  registry: IntegrationProviderRegistry,
  sourceControl: IntegrationSourceControlService,
  options: CreateIntegrationRoutesOptions = {},
): RouteExport[] {
  const providerRoutes = registry.list().flatMap((provider) => provider.routes ?? []);
  const agentToolsRoutes = options.agentTools
    ? [
        createAgentToolsGatewayRoutes({
          registry,
          loadLeasedAgentStep: options.agentTools.loadLeasedAgentStep,
          getIntegrationConnectionById: options.agentTools.getIntegrationConnectionById,
        }),
      ]
    : [];

  return [
    createListIntegrationProvidersRoute(registry),
    createListIntegrationConnectionsRoute(registry),
    createUpdateIntegrationConnectionRoute(registry),
    createDeleteIntegrationConnectionRoute(registry),
    createListRepositoriesRoute(sourceControl),
    ...agentToolsRoutes,
    ...providerRoutes,
  ];
}
