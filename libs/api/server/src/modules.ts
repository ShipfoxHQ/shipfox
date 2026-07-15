import {annotationsModule} from '@shipfox/annotations';
import {agentModule} from '@shipfox/api-agent';
import {authModule} from '@shipfox/api-auth';
import {createDefinitionsModule} from '@shipfox/api-definitions';
import {dispatcherModule} from '@shipfox/api-dispatcher';
import {
  buildAgentToolCatalogs,
  buildAgentToolSelectionCatalogs,
  createIntegrationsContext,
  createWorkspaceConnectionSnapshotLoader,
  getIntegrationConnectionById,
} from '@shipfox/api-integration-core';
import {logsModule} from '@shipfox/api-logs';
import {createProjectsModule} from '@shipfox/api-projects';
import {runnersModule} from '@shipfox/api-runners';
import {deleteSecrets, getSecret, secretsModule, setSecrets} from '@shipfox/api-secrets';
import {triggersModule} from '@shipfox/api-triggers';
import {
  loadRunningLeasedStep,
  setAgentToolMaterializationServices,
  setSourceControl,
  workflowsModule,
} from '@shipfox/api-workflows';
import {workspacesModule} from '@shipfox/api-workspaces';
import type {ShipfoxModule} from '@shipfox/node-module';

export async function defaultModules(): Promise<ShipfoxModule[]> {
  const integrations = await createIntegrationsContext({
    secrets: {
      deleteSecrets,
      linear: {
        getSecret: (params) =>
          getSecret({
            ...params,
            namespace: `system/integrations/linear/${params.namespace}`,
          }),
        setSecrets: (params) =>
          setSecrets({
            ...params,
            namespace: `system/integrations/linear/${params.namespace}`,
          }),
        deleteSecrets: (params) =>
          deleteSecrets({
            ...params,
            namespace: `system/integrations/linear/${params.namespace}`,
          }),
      },
    },
    agentTools: {loadLeasedAgentStep: loadRunningLeasedStep},
  });
  const [agentToolSelectionCatalogs, agentToolCatalogs] = await Promise.all([
    buildAgentToolSelectionCatalogs(integrations.registry),
    buildAgentToolCatalogs(integrations.registry),
  ]);
  const loadWorkspaceConnectionSnapshot = createWorkspaceConnectionSnapshotLoader(
    integrations.registry,
  );

  // The checkout-token route resolves intents and mints credentials through the
  // source-control service; wire it into the workflows module before serving.
  setSourceControl(integrations.sourceControl);
  setAgentToolMaterializationServices({
    catalogs: agentToolCatalogs,
    loadWorkspaceConnectionSnapshot,
    getIntegrationConnectionById,
  });
  const projectsModule = createProjectsModule({sourceControl: integrations.sourceControl});
  const definitionsModule = createDefinitionsModule({
    sourceControl: integrations.sourceControl,
    agentToolSelectionCatalogs,
    loadWorkspaceConnectionSnapshot,
    getIntegrationConnectionById,
  });

  return [
    authModule,
    workspacesModule,
    secretsModule,
    agentModule,
    integrations.module,
    projectsModule,
    definitionsModule,
    workflowsModule,
    annotationsModule,
    runnersModule,
    logsModule,
    triggersModule,
    dispatcherModule,
  ];
}
