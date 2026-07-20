import {
  type IntegrationsModuleClient,
  integrationsInterModuleContract,
} from '@shipfox/api-integration-core-dto';

export type DefinitionsSourceControl = {
  resolveRepository: IntegrationsModuleClient['resolveSourceRepository'];
  listFiles: IntegrationsModuleClient['listSourceFiles'];
  fetchFile: IntegrationsModuleClient['fetchSourceFile'];
};

export function createDefinitionsSourceControl(
  integrations: IntegrationsModuleClient,
): DefinitionsSourceControl {
  return {
    resolveRepository: integrations.resolveSourceRepository,
    listFiles: integrations.listSourceFiles,
    fetchFile: integrations.fetchSourceFile,
  };
}

export async function loadIntegrationValidationContext(
  integrations: IntegrationsModuleClient,
  workspaceId: string,
  defaultConnectionId: string,
) {
  const context = await integrations.getAgentToolsContext({workspaceId, defaultConnectionId});
  return {
    agentToolSelectionCatalogs: new Map(
      context.selectionCatalogs.map(({provider, selectors}) => [provider, {selectors}]),
    ),
    workspaceConnectionSnapshot: new Map(
      context.workspaceConnections.map(({slug, ...connection}) => [slug, connection]),
    ),
    defaultConnectionSlug: context.defaultConnection?.slug,
  };
}

export {integrationsInterModuleContract};
