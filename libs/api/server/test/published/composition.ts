import {
  createServer,
  type DefaultAgentModuleOptions,
  type DefaultModulesExtension,
  defaultModules,
} from '@shipfox/api-server';

const managedProvider: NonNullable<DefaultAgentModuleOptions['managedProvider']> = {
  id: 'managed',
  label: 'Managed',
  models: [{id: 'managed-model', label: 'Managed model', api: 'openai-responses'}],
  defaultModel: 'managed-model',
  resolveCredentials: async () => ({
    api: 'openai-responses',
    baseUrl: 'https://gateway.example.test',
    credentials: {},
  }),
};

const extension: DefaultModulesExtension = ({workspaces, usage}) => {
  void workspaces;
  void usage.recordInferenceSegments;
  return [{name: 'external-dummy'}];
};

const modules = await defaultModules({
  agentModuleOptions: {managedProvider},
  runnersModuleOptions: {
    installationProvisioning: {
      policy: {
        filterEligibleWorkspaceIds: async (workspaceIds) => new Set(workspaceIds),
      },
    },
  },
  extension,
});

void createServer({
  modules,
});
