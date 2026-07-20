import {definitionsInterModuleContract} from '@shipfox/api-definitions-dto/inter-module';
import {projectsInterModuleContract} from '@shipfox/api-projects-dto';
import {runnersInterModuleContract} from '@shipfox/api-runners-dto/inter-module';
import {workflowsInterModuleContract} from '@shipfox/api-workflows-dto/inter-module';
import {defineInterModulePresentation} from '@shipfox/inter-module';
import {defaultModules} from './modules.js';

const mocks = vi.hoisted(() => ({
  buildAgentToolCatalogs: vi.fn(),
  buildAgentToolSelectionCatalogs: vi.fn(),
  createDefinitionsModule: vi.fn(),
  createIntegrationsContext: vi.fn(),
  createProjectsModule: vi.fn(),
  createSecretsModule: vi.fn(),
  createTriggersModule: vi.fn(),
  createWorkflowsModule: vi.fn(),
  createWorkspaceConnectionSnapshotLoader: vi.fn(),
  deleteSecrets: vi.fn(),
  getIntegrationConnectionById: vi.fn(),
  getSecret: vi.fn(),
  loadRunningLeasedStep: vi.fn(),
  setAgentToolMaterializationServices: vi.fn(),
  setSecrets: vi.fn(),
  setSourceControl: vi.fn(),
}));

vi.mock('@shipfox/api-agent', () => ({agentModule: {name: 'agent'}}));
vi.mock('@shipfox/annotations', () => ({annotationsModule: {name: 'annotations'}}));
vi.mock('@shipfox/api-auth', () => ({authModule: {name: 'auth'}}));
vi.mock('@shipfox/api-definitions', () => ({
  createDefinitionsModule: mocks.createDefinitionsModule,
}));
vi.mock('@shipfox/api-dispatcher', () => ({dispatcherModule: {name: 'dispatcher'}}));
vi.mock('@shipfox/api-integration-core', () => ({
  buildAgentToolCatalogs: mocks.buildAgentToolCatalogs,
  buildAgentToolSelectionCatalogs: mocks.buildAgentToolSelectionCatalogs,
  createIntegrationsContext: mocks.createIntegrationsContext,
  createWorkspaceConnectionSnapshotLoader: mocks.createWorkspaceConnectionSnapshotLoader,
  getIntegrationConnectionById: mocks.getIntegrationConnectionById,
}));
vi.mock('@shipfox/api-logs', () => ({logsModule: {name: 'logs'}}));
vi.mock('@shipfox/api-projects', () => ({createProjectsModule: mocks.createProjectsModule}));
vi.mock('@shipfox/api-runners', () => ({
  runnersModule: {
    name: 'runners',
    interModulePresentations: [
      {
        contract: runnersInterModuleContract,
        handlers: {
          cancelJobs: vi.fn(),
          enqueueJobExecution: vi.fn(),
          getEffectiveRunnerToolCapabilities: vi.fn(),
          getLeaseState: vi.fn(),
          releaseJobExecution: vi.fn(),
        },
      },
    ],
  },
}));
vi.mock('@shipfox/api-secrets', () => ({
  createSecretsModule: mocks.createSecretsModule,
  deleteSecrets: mocks.deleteSecrets,
  getSecret: mocks.getSecret,
  secretsModule: {name: 'secrets'},
  setSecrets: mocks.setSecrets,
}));
vi.mock('@shipfox/api-triggers', () => ({createTriggersModule: mocks.createTriggersModule}));
vi.mock('@shipfox/api-workflows', () => ({
  createWorkflowsModule: mocks.createWorkflowsModule,
  loadRunningLeasedStep: mocks.loadRunningLeasedStep,
  setAgentToolMaterializationServices: mocks.setAgentToolMaterializationServices,
  setSourceControl: mocks.setSourceControl,
  workflowsModule: {name: 'workflows'},
}));
vi.mock('@shipfox/api-workspaces', () => ({workspacesModule: {name: 'workspaces'}}));

describe('defaultModules', () => {
  beforeEach(() => {
    mocks.buildAgentToolCatalogs.mockReset();
    mocks.buildAgentToolSelectionCatalogs.mockReset();
    mocks.createDefinitionsModule.mockReset();
    mocks.createIntegrationsContext.mockReset();
    mocks.createProjectsModule.mockReset();
    mocks.createSecretsModule.mockReset();
    mocks.createTriggersModule.mockReset();
    mocks.createWorkflowsModule.mockReset();
    mocks.createWorkspaceConnectionSnapshotLoader.mockReset();
    mocks.deleteSecrets.mockReset();
    mocks.getIntegrationConnectionById.mockReset();
    mocks.getSecret.mockReset();
    mocks.loadRunningLeasedStep.mockReset();
    mocks.setAgentToolMaterializationServices.mockReset();
    mocks.setSecrets.mockReset();
    mocks.setSourceControl.mockReset();

    mocks.createIntegrationsContext.mockResolvedValue({
      module: {name: 'integrations'},
      registry: {},
      sourceControl: {provider: 'source-control'},
    });
    mocks.buildAgentToolCatalogs.mockResolvedValue(new Map());
    mocks.buildAgentToolSelectionCatalogs.mockResolvedValue(new Map());
    mocks.createWorkspaceConnectionSnapshotLoader.mockReturnValue(vi.fn());
    mocks.createProjectsModule.mockReturnValue({
      name: 'projects',
      interModulePresentations: [
        defineInterModulePresentation(projectsInterModuleContract, {
          getProjectById: () => ({project: null}),
          requireProjectForWorkspace: () => ({
            project: {
              id: crypto.randomUUID(),
              workspaceId: crypto.randomUUID(),
              sourceConnectionId: crypto.randomUUID(),
              sourceExternalRepositoryId: 'repo',
              name: 'Project',
            },
          }),
        }),
      ],
    });
    mocks.createSecretsModule.mockReturnValue({name: 'secrets'});
    mocks.createDefinitionsModule.mockReturnValue({
      name: 'definitions',
      interModulePresentations: [
        {
          contract: definitionsInterModuleContract,
          handlers: {getDefinitionForWorkflowRun: vi.fn()},
        },
      ],
    });
    mocks.createWorkflowsModule.mockReturnValue({
      name: 'workflows',
      interModulePresentations: [
        {
          contract: workflowsInterModuleContract,
          handlers: {
            deliverEventToJobListener: vi.fn(),
            startRunFromTrigger: vi.fn(),
          },
        },
      ],
    });
    mocks.createTriggersModule.mockReturnValue({name: 'triggers'});
  });

  it('returns the API modules in lifecycle order', async () => {
    const modules = await defaultModules();

    expect(modules.map((module) => module.name)).toEqual([
      'auth',
      'workspaces',
      'secrets',
      'agent',
      'integrations',
      'projects',
      'definitions',
      'workflows',
      'annotations',
      'runners',
      'logs',
      'triggers',
      'dispatcher',
    ]);
  });

  it('replaces only the runners module when a host provides one', async () => {
    const runnersModule = {
      name: 'runners',
      interModulePresentations: [
        {
          contract: runnersInterModuleContract,
          handlers: {
            cancelJobs: vi.fn(),
            enqueueJobExecution: vi.fn(),
            getEffectiveRunnerToolCapabilities: vi.fn(),
            getLeaseState: vi.fn(),
            releaseJobExecution: vi.fn(),
          },
        },
      ],
    };

    const modules = await defaultModules({runnersModule});

    expect(modules).toContain(runnersModule);
    expect(modules.filter((module) => module.name === 'runners')).toEqual([runnersModule]);
    expect(modules.map((module) => module.name)).toEqual([
      'auth',
      'workspaces',
      'secrets',
      'agent',
      'integrations',
      'projects',
      'definitions',
      'workflows',
      'annotations',
      'runners',
      'logs',
      'triggers',
      'dispatcher',
    ]);
  });

  it('uses the leased-step loader and namespaced provider secrets', async () => {
    await defaultModules();

    expect(mocks.createIntegrationsContext).toHaveBeenCalledWith({
      secrets: {
        deleteSecrets: mocks.deleteSecrets,
        linear: {
          deleteSecrets: expect.any(Function),
          getSecret: expect.any(Function),
          setSecrets: expect.any(Function),
        },
        jira: {
          deleteSecrets: expect.any(Function),
          getSecret: expect.any(Function),
          setSecrets: expect.any(Function),
        },
        slack: {
          deleteSecrets: expect.any(Function),
          getSecret: expect.any(Function),
          setSecrets: expect.any(Function),
        },
      },
      agentTools: {loadLeasedAgentStep: expect.any(Function)},
      webhookDeliverySource: undefined,
    });

    const integrationsOptions = mocks.createIntegrationsContext.mock.calls[0]?.[0] as {
      secrets: {
        linear: {
          deleteSecrets: (params: {namespace: string}) => unknown;
          getSecret: (params: {namespace: string}) => unknown;
          setSecrets: (params: {namespace: string}) => unknown;
        };
        jira: {
          deleteSecrets: (params: {namespace: string}) => unknown;
          getSecret: (params: {namespace: string}) => unknown;
          setSecrets: (params: {namespace: string}) => unknown;
        };
        slack: {
          deleteSecrets: (params: {namespace: string}) => unknown;
          getSecret: (params: {namespace: string}) => unknown;
          setSecrets: (params: {namespace: string}) => unknown;
        };
      };
      agentTools: {loadLeasedAgentStep: (params: {stepId: string}) => unknown};
    };
    integrationsOptions.agentTools.loadLeasedAgentStep({stepId: 'step-1'});
    expect(mocks.loadRunningLeasedStep).toHaveBeenCalledWith({
      stepId: 'step-1',
      runners: expect.objectContaining({enqueueJobExecution: expect.any(Function)}),
    });

    integrationsOptions.secrets.linear.getSecret({namespace: 'workspace'});
    integrationsOptions.secrets.linear.setSecrets({namespace: 'workspace'});
    integrationsOptions.secrets.linear.deleteSecrets({namespace: 'workspace'});
    integrationsOptions.secrets.jira.getSecret({namespace: 'workspace'});
    integrationsOptions.secrets.jira.setSecrets({namespace: 'workspace'});
    integrationsOptions.secrets.jira.deleteSecrets({namespace: 'workspace'});
    integrationsOptions.secrets.slack.getSecret({namespace: 'workspace'});
    integrationsOptions.secrets.slack.setSecrets({namespace: 'workspace'});
    integrationsOptions.secrets.slack.deleteSecrets({namespace: 'workspace'});

    expect(mocks.getSecret).toHaveBeenCalledWith({
      namespace: 'system/integrations/linear/workspace',
    });
    expect(mocks.setSecrets).toHaveBeenCalledWith({
      namespace: 'system/integrations/linear/workspace',
    });
    expect(mocks.deleteSecrets).toHaveBeenCalledWith({
      namespace: 'system/integrations/linear/workspace',
    });
    expect(mocks.getSecret).toHaveBeenCalledWith({
      namespace: 'system/integrations/jira/workspace',
    });
    expect(mocks.setSecrets).toHaveBeenCalledWith({
      namespace: 'system/integrations/jira/workspace',
    });
    expect(mocks.deleteSecrets).toHaveBeenCalledWith({
      namespace: 'system/integrations/jira/workspace',
    });
    expect(mocks.getSecret).toHaveBeenCalledWith({
      namespace: 'system/integrations/slack/workspace',
    });
    expect(mocks.setSecrets).toHaveBeenCalledWith({
      namespace: 'system/integrations/slack/workspace',
    });
    expect(mocks.deleteSecrets).toHaveBeenCalledWith({
      namespace: 'system/integrations/slack/workspace',
    });
  });

  it('passes an optional webhook delivery source to integration composition', async () => {
    const webhookDeliverySource = {createService: vi.fn()};

    await defaultModules({webhookDeliverySource});

    expect(mocks.createIntegrationsContext).toHaveBeenCalledWith(
      expect.objectContaining({webhookDeliverySource}),
    );
  });
});
