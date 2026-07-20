import {annotationsModule} from '@shipfox/annotations';
import {annotationsInterModuleContract} from '@shipfox/annotations-dto/inter-module';
import {createAgentModule} from '@shipfox/api-agent';
import {authModule} from '@shipfox/api-auth';
import {createDefinitionsModule} from '@shipfox/api-definitions';
import {definitionsInterModuleContract} from '@shipfox/api-definitions-dto/inter-module';
import {dispatcherModule} from '@shipfox/api-dispatcher';
import {
  buildAgentToolCatalogs,
  buildAgentToolSelectionCatalogs,
  createIntegrationsContext,
  createWorkspaceConnectionSnapshotLoader,
  getIntegrationConnectionById,
  type WebhookDeliverySource,
} from '@shipfox/api-integration-core';
import {createLogsModule} from '@shipfox/api-logs';
import {createProjectsModule} from '@shipfox/api-projects';
import {projectsInterModuleContract} from '@shipfox/api-projects-dto';
import {runnersModule as defaultRunnersModule} from '@shipfox/api-runners';
import {runnersInterModuleContract} from '@shipfox/api-runners-dto/inter-module';
import {createSecretsModule} from '@shipfox/api-secrets';
import {secretsInterModuleContract} from '@shipfox/api-secrets-dto/inter-module';
import {createTriggersModule} from '@shipfox/api-triggers';
import {
  createWorkflowsModule,
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
  const projectsClient = interModuleTransport.createClient(projectsInterModuleContract);
  const definitionsClient = interModuleTransport.createClient(definitionsInterModuleContract);
  const annotationsClient = interModuleTransport.createClient(annotationsInterModuleContract);
  const secretsClient = interModuleTransport.createClient(secretsInterModuleContract);
  const integrations = await createIntegrationsContext({
    secrets: {
      deleteSecrets: async (params) => (await secretsClient.deleteSecrets(params)).deleted,
      linear: {
        getSecret: async (params) =>
          (
            await secretsClient.getSecret({
              ...params,
              namespace: `system/integrations/linear/${params.namespace}`,
            })
          ).value,
        setSecrets: async (params) => {
          const {editedBy, ...secretParams} = params;
          await secretsClient.setSecrets({
            ...secretParams,
            namespace: `system/integrations/linear/${secretParams.namespace}`,
            ...(editedBy === undefined ? {} : {editedBy}),
          });
        },
        deleteSecrets: async (params) =>
          (
            await secretsClient.deleteSecrets({
              ...params,
              namespace: `system/integrations/linear/${params.namespace}`,
            })
          ).deleted,
      },
      jira: {
        getSecret: async (params) =>
          (
            await secretsClient.getSecret({
              ...params,
              namespace: `system/integrations/jira/${params.namespace}`,
            })
          ).value,
        setSecrets: async (params) => {
          const {editedBy, ...secretParams} = params;
          await secretsClient.setSecrets({
            ...secretParams,
            namespace: `system/integrations/jira/${secretParams.namespace}`,
            ...(editedBy === undefined ? {} : {editedBy}),
          });
        },
        deleteSecrets: async (params) =>
          (
            await secretsClient.deleteSecrets({
              ...params,
              namespace: `system/integrations/jira/${params.namespace}`,
            })
          ).deleted,
      },
      slack: {
        getSecret: async (params) =>
          (
            await secretsClient.getSecret({
              ...params,
              namespace: `system/integrations/slack/${params.namespace}`,
            })
          ).value,
        setSecrets: async (params) => {
          const {editedBy, ...secretParams} = params;
          await secretsClient.setSecrets({
            ...secretParams,
            namespace: `system/integrations/slack/${secretParams.namespace}`,
            ...(editedBy === undefined ? {} : {editedBy}),
          });
        },
        deleteSecrets: async (params) =>
          (
            await secretsClient.deleteSecrets({
              ...params,
              namespace: `system/integrations/slack/${params.namespace}`,
            })
          ).deleted,
      },
    },
    agentTools: {workflows: workflowsClient},
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
    projects: projectsClient,
    catalogs: agentToolCatalogs,
    loadWorkspaceConnectionSnapshot,
    getIntegrationConnectionById,
  });
  const projectsModule = createProjectsModule({sourceControl: integrations.sourceControl});
  const definitionsModule = createDefinitionsModule({
    projects: projectsClient,
    sourceControl: integrations.sourceControl,
    agentToolSelectionCatalogs,
    loadWorkspaceConnectionSnapshot,
    getIntegrationConnectionById,
  });

  const modules = [
    authModule,
    workspacesModule,
    createSecretsModule(projectsClient),
    createAgentModule({secrets: secretsClient}),
    integrations.module,
    projectsModule,
    definitionsModule,
    createWorkflowsModule({
      annotations: annotationsClient,
      definitions: definitionsClient,
      projects: projectsClient,
      runners: runnersClient,
      secrets: secretsClient,
    }),
    annotationsModule,
    options.runnersModule ?? defaultRunnersModule,
    createLogsModule({workflows: workflowsClient}),
    createTriggersModule({workflows: workflowsClient}),
    dispatcherModule,
  ];
  registerInterModulePresentations({transport: interModuleTransport, modules});
  interModuleTransport.seal();
  return modules;
}
