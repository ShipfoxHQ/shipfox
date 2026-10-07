import {
  SHIPFOX_BUILTIN_CONNECTION_ID,
  shipfoxEventCatalog,
} from '@shipfox/api-integration-shipfox-dto';
import {config} from '#config.js';
import type {IntegrationModuleParts, IntegrationProviderModule} from '#providers/types.js';

async function loadShipfoxModuleParts(
  options: Parameters<IntegrationProviderModule['load']>[0] = {},
): Promise<IntegrationModuleParts> {
  const {createShipfoxAgentToolsProvider} = await import('@shipfox/api-integration-shipfox');
  const interModule = options.interModule;
  return {
    provider: {
      provider: 'shipfox',
      displayName: 'Shipfox',
      eventCatalog: shipfoxEventCatalog,
      ...(interModule === undefined
        ? {}
        : {
            adapters: {
              agent_tools: createShipfoxAgentToolsProvider({
                annotations: interModule.annotations,
                clientBaseUrl: config.CLIENT_BASE_URL,
                definitions: interModule.definitions,
                projects: interModule.projects,
                logs: interModule.logs,
                triggers: interModule.triggers,
                workflows: interModule.workflows,
              }),
            },
          }),
    },
    builtinConnection: {
      slug: 'shipfox',
      id: SHIPFOX_BUILTIN_CONNECTION_ID,
    },
  };
}

export const shipfoxProviderModule: IntegrationProviderModule = {
  id: 'shipfox',
  enabled: true,
  builtinConnection: {
    slug: 'shipfox',
    id: SHIPFOX_BUILTIN_CONNECTION_ID,
  },
  load: loadShipfoxModuleParts,
};
