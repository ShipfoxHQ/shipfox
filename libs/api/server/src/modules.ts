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
  type WebhookDeliverySource,
} from '@shipfox/api-integration-core';
import {logsModule} from '@shipfox/api-logs';
import {createProjectsModule} from '@shipfox/api-projects';
import {runnersModule as defaultRunnersModule} from '@shipfox/api-runners';
import {runnersInterModuleContract} from '@shipfox/api-runners-dto/inter-module';
import {deleteSecrets, getSecret, secretsModule, setSecrets} from '@shipfox/api-secrets';
import {createTriggersModule} from '@shipfox/api-triggers';
import {
  createWorkflowsModule,
  loadRunningLeasedStep,
  setAgentToolMaterializationServices,
  setSourceControl,
} from '@shipfox/api-workflows';
import {workflowsInterModuleContract} from '@shipfox/api-workflows-dto/inter-module';
import {workspacesModule} from '@shipfox/api-workspaces';
import type {ShipfoxModule} from '@shipfox/node-module';
import {
  createInMemoryInterModuleTransport,
  registerInterModulePresentations,
} from '@shipfox/node-module/inter-module';

export interface DefaultModulesOptions {
  runnersModule?: ShipfoxModule;
  webhookDeliverySource?: WebhookDeliverySource | undefined;
}

export async function defaultModules(
  options: DefaultModulesOptions = {},
): Promise<ShipfoxModule[]> {
  const interModuleTransport = createInMemoryInterModuleTransport();
  const workflowsClient = interModuleTransport.createClient(workflowsInterModuleContract);
  const runnersClient = interModuleTransport.createClient(runnersInterModuleContract);
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
      jira: {
        getSecret: (params) =>
          getSecret({...params, namespace: `system/integrations/jira/${params.namespace}`}),
        setSecrets: (params) =>
          setSecrets({...params, namespace: `system/integrations/jira/${params.namespace}`}),
        deleteSecrets: (params) =>
          deleteSecrets({...params, namespace: `system/integrations/jira/${params.namespace}`}),
      },
      slack: {
        getSecret: (params) =>
          getSecret({
            ...params,
            namespace: `system/integrations/slack/${params.namespace}`,
          }),
        setSecrets: (params) =>
          setSecrets({
            ...params,
            namespace: `system/integrations/slack/${params.namespace}`,
          }),
        deleteSecrets: (params) =>
          deleteSecrets({
            ...params,
            namespace: `system/integrations/slack/${params.namespace}`,
          }),
      },
    },
    agentTools: {
      loadLeasedAgentStep: (params) => loadRunningLeasedStep({runners: runnersClient, ...params}),
    },
    webhookDeliverySource: options.webhookDeliverySource,
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

  const modules = [
    authModule,
    workspacesModule,
    secretsModule,
    agentModule,
    integrations.module,
    projectsModule,
    definitionsModule,
    createWorkflowsModule({runners: runnersClient}),
    annotationsModule,
    options.runnersModule ?? defaultRunnersModule,
    logsModule,
    createTriggersModule({workflows: workflowsClient}),
    dispatcherModule,
  ];
  registerInterModulePresentations({transport: interModuleTransport, modules});
  interModuleTransport.seal();
  return modules;
}
