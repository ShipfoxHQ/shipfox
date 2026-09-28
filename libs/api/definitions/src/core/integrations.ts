import {
  type IntegrationsModuleClient,
  integrationsInterModuleContract,
} from '@shipfox/api-integration-core-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';

export const FILE_FETCH_CONCURRENCY = 4;

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

/** Whether a source file fetch failed because the file is not UTF-8 text. */
export function isBinaryFileError(error: unknown): boolean {
  return (
    isInterModuleKnownError(integrationsInterModuleContract.methods.fetchSourceFile, error) &&
    error.code === 'provider-failure' &&
    error.details.reason === 'binary-file-unsupported'
  );
}

export async function loadIntegrationValidationContext(
  integrations: IntegrationsModuleClient,
  workspaceId: string,
  defaultConnectionId: string,
  signal?: AbortSignal,
) {
  const input = {workspaceId, defaultConnectionId};
  const context =
    signal === undefined
      ? await integrations.getAgentToolsContext(input)
      : await integrations.getAgentToolsContext(input, {signal});
  return {
    agentToolSelectionCatalogs: new Map(
      context.selectionCatalogs.map(({provider, selectors}) => [provider, {selectors}]),
    ),
    agentToolCatalogs: new Map(
      context.catalogs.map(({provider, tools}) => [
        provider,
        {
          tools: tools.map(({outputSchema, methods, ...tool}) => ({
            ...tool,
            ...(outputSchema === undefined ? {} : {outputSchema}),
            ...(methods === undefined ? {} : {methods}),
          })),
        },
      ]),
    ),
    workspaceConnectionSnapshot: new Map(
      context.workspaceConnections.map(({slug, ...connection}) => [slug, connection]),
    ),
    eventCatalogs: new Map(
      context.eventCatalogs.map(({provider, events}) => [provider, new Set(events)]),
    ),
    fixedEventProviders: new Set(context.fixedEventProviders),
    defaultConnectionSlug: context.defaultConnection?.slug,
  };
}

export {integrationsInterModuleContract};
