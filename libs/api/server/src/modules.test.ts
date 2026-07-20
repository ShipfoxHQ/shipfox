import {annotationsInterModuleContract} from '@shipfox/annotations-dto/inter-module';
import {agentInterModuleContract} from '@shipfox/api-agent-dto/inter-module';
import {authInterModuleContract} from '@shipfox/api-auth-dto/inter-module';
import {definitionsInterModuleContract} from '@shipfox/api-definitions-dto/inter-module';
import {projectsInterModuleContract} from '@shipfox/api-projects-dto';
import {runnersInterModuleContract} from '@shipfox/api-runners-dto/inter-module';
import {
  type SecretsInterModuleClient,
  secretsInterModuleContract,
} from '@shipfox/api-secrets-dto/inter-module';
import {workflowsInterModuleContract} from '@shipfox/api-workflows-dto/inter-module';
import {workspacesInterModuleContract} from '@shipfox/api-workspaces-dto/inter-module';
import {defineInterModulePresentation} from '@shipfox/inter-module';
import {defaultModules} from './modules.js';

const mocks = vi.hoisted(() => ({
  buildAgentToolCatalogs: vi.fn(),
  buildAgentToolSelectionCatalogs: vi.fn(),
  createAgentModule: vi.fn(),
  createDefinitionsModule: vi.fn(),
  createIntegrationsContext: vi.fn(),
  createLogsModule: vi.fn(),
  createProjectsModule: vi.fn(),
  createRunnersModule: vi.fn(),
  createSecretsModule: vi.fn(),
  createTriggersModule: vi.fn(),
  createWorkflowsModule: vi.fn(),
  createWorkspaceConnectionSnapshotLoader: vi.fn(),
  deleteSecrets: vi.fn(),
  getIntegrationConnectionById: vi.fn(),
  getSecret: vi.fn(),
  setAgentToolMaterializationServices: vi.fn(),
  setSecrets: vi.fn(),
  setSourceControl: vi.fn(),
}));

vi.mock('@shipfox/annotations', () => ({
  annotationsModule: {
    name: 'annotations',
    interModulePresentations: [
      {
        contract: annotationsInterModuleContract,
        handlers: {replaceOrRemoveAnnotation: vi.fn()},
      },
    ],
  },
}));
vi.mock('@shipfox/api-auth', () => ({
  createAuthModule: () => ({
    name: 'auth',
    interModulePresentations: [
      {
        contract: authInterModuleContract,
        handlers: {
          mintJobLeaseToken: vi.fn(),
          mintRunnerSessionToken: vi.fn(),
        },
      },
    ],
  }),
}));
vi.mock('@shipfox/api-agent', () => ({createAgentModule: mocks.createAgentModule}));
vi.mock('@shipfox/api-auth/config', () => ({
  config: {AUTH_JOB_LEASE_TOKEN_EXPIRES_IN: '90m'},
}));
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
vi.mock('@shipfox/api-logs', () => ({createLogsModule: mocks.createLogsModule}));
vi.mock('@shipfox/api-projects', () => ({createProjectsModule: mocks.createProjectsModule}));
vi.mock('@shipfox/api-runners', () => ({createRunnersModule: mocks.createRunnersModule}));
vi.mock('@shipfox/api-secrets', () => ({
  createSecretsModule: mocks.createSecretsModule,
  deleteSecrets: mocks.deleteSecrets,
  getSecret: mocks.getSecret,
  setSecrets: mocks.setSecrets,
}));
vi.mock('@shipfox/api-triggers', () => ({createTriggersModule: mocks.createTriggersModule}));
vi.mock('@shipfox/api-workflows', () => ({
  createWorkflowsModule: mocks.createWorkflowsModule,
  setAgentToolMaterializationServices: mocks.setAgentToolMaterializationServices,
  setSourceControl: mocks.setSourceControl,
  workflowsModule: {name: 'workflows'},
}));
vi.mock('@shipfox/api-workspaces', () => ({
  workspacesModule: {
    name: 'workspaces',
    interModulePresentations: [
      {
        contract: workspacesInterModuleContract,
        handlers: {
          listMembershipsForTokenClaims: vi.fn(),
          preflightInvitationAcceptance: vi.fn(),
          acceptInvitation: vi.fn(),
          requireActiveMembership: vi.fn(),
        },
      },
    ],
  },
}));

describe('defaultModules', () => {
  beforeEach(() => {
    mocks.buildAgentToolCatalogs.mockReset();
    mocks.buildAgentToolSelectionCatalogs.mockReset();
    mocks.createAgentModule.mockReset();
    mocks.createDefinitionsModule.mockReset();
    mocks.createIntegrationsContext.mockReset();
    mocks.createLogsModule.mockReset();
    mocks.createProjectsModule.mockReset();
    mocks.createRunnersModule.mockReset();
    mocks.createSecretsModule.mockReset();
    mocks.createTriggersModule.mockReset();
    mocks.createWorkflowsModule.mockReset();
    mocks.createWorkspaceConnectionSnapshotLoader.mockReset();
    mocks.deleteSecrets.mockReset();
    mocks.getIntegrationConnectionById.mockReset();
    mocks.getSecret.mockReset();
    mocks.setAgentToolMaterializationServices.mockReset();
    mocks.setSecrets.mockReset();
    mocks.setSourceControl.mockReset();

    mocks.createIntegrationsContext.mockResolvedValue({
      module: {name: 'integrations'},
      registry: {},
      sourceControl: {provider: 'source-control'},
    });
    mocks.createLogsModule.mockReturnValue({name: 'logs'});
    mocks.buildAgentToolCatalogs.mockResolvedValue(new Map());
    mocks.buildAgentToolSelectionCatalogs.mockResolvedValue(new Map());
    mocks.createWorkspaceConnectionSnapshotLoader.mockReturnValue(vi.fn());
    mocks.deleteSecrets.mockResolvedValue({deleted: 1});
    mocks.getSecret.mockResolvedValue({value: 'secret'});
    mocks.setSecrets.mockResolvedValue({});
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
    mocks.createSecretsModule.mockReturnValue({
      name: 'secrets',
      interModulePresentations: [
        defineInterModulePresentation(secretsInterModuleContract, {
          deleteSecrets: mocks.deleteSecrets,
          getSecret: mocks.getSecret,
          getSecretsByNamespace: vi.fn(),
          getVariablesByNamespace: vi.fn(),
          setSecrets: mocks.setSecrets,
        }),
      ],
    });
    mocks.createAgentModule.mockReturnValue({
      name: 'agent',
      interModulePresentations: [
        {
          contract: agentInterModuleContract,
          handlers: {resolveAgentConfig: vi.fn(), resolveRuntimeCredentials: vi.fn()},
        },
      ],
    });
    mocks.createRunnersModule.mockReturnValue({
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
    });
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
            getLeasedAgentToolContext: vi.fn(),
            getStepLogContext: vi.fn(),
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

  it('injects Auth into a host-provided runners module factory', async () => {
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

    const createRunnersModule = vi.fn(() => runnersModule);
    const modules = await defaultModules({createRunnersModule});

    expect(modules).toContain(runnersModule);
    expect(createRunnersModule).toHaveBeenCalledWith({auth: expect.any(Object)});
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

  it('injects Workflows into integrations and logs and namespaces provider secrets', async () => {
    await defaultModules();

    expect(mocks.createIntegrationsContext).toHaveBeenCalledWith({
      workspaces: expect.anything(),
      secrets: {
        deleteSecrets: expect.any(Function),
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
      agentTools: {workflows: expect.objectContaining({getStepLogContext: expect.any(Function)})},
      webhookDeliverySource: undefined,
    });

    const integrationsOptions = mocks.createIntegrationsContext.mock.calls[0]?.[0] as {
      secrets: {
        linear: Pick<SecretsInterModuleClient, 'deleteSecrets' | 'getSecret' | 'setSecrets'>;
        jira: Pick<SecretsInterModuleClient, 'deleteSecrets' | 'getSecret' | 'setSecrets'>;
        slack: Pick<SecretsInterModuleClient, 'deleteSecrets' | 'getSecret' | 'setSecrets'>;
      };
      agentTools: {workflows: unknown};
    };
    expect(integrationsOptions.agentTools.workflows).toEqual(
      expect.objectContaining({getLeasedAgentToolContext: expect.any(Function)}),
    );
    expect(mocks.createLogsModule).toHaveBeenCalledWith({
      workflows: expect.objectContaining({getStepLogContext: expect.any(Function)}),
      jobLeaseTokenTtlSeconds: 5400,
    });

    const scope = {workspaceId: crypto.randomUUID(), projectId: null, namespace: 'workspace'};
    await Promise.all([
      integrationsOptions.secrets.linear.getSecret({...scope, key: 'token'}),
      integrationsOptions.secrets.linear.setSecrets({
        ...scope,
        values: {token: 'secret'},
        editedBy: undefined,
      }),
      integrationsOptions.secrets.linear.deleteSecrets({...scope, keys: ['token']}),
      integrationsOptions.secrets.jira.getSecret({...scope, key: 'token'}),
      integrationsOptions.secrets.jira.setSecrets({
        ...scope,
        values: {token: 'secret'},
        editedBy: undefined,
      }),
      integrationsOptions.secrets.jira.deleteSecrets({...scope, keys: ['token']}),
      integrationsOptions.secrets.slack.getSecret({...scope, key: 'token'}),
      integrationsOptions.secrets.slack.setSecrets({
        ...scope,
        values: {token: 'secret'},
        editedBy: undefined,
      }),
      integrationsOptions.secrets.slack.deleteSecrets({...scope, keys: ['token']}),
    ]);

    expect(mocks.getSecret.mock.calls.map(([params]) => params)).toContainEqual({
      key: 'token',
      namespace: 'system/integrations/linear/workspace',
      projectId: null,
      workspaceId: scope.workspaceId,
    });
    expect(mocks.setSecrets.mock.calls.map(([params]) => params)).toContainEqual({
      values: {token: 'secret'},
      namespace: 'system/integrations/linear/workspace',
      projectId: null,
      workspaceId: scope.workspaceId,
    });
    expect(mocks.deleteSecrets.mock.calls.map(([params]) => params)).toContainEqual({
      keys: ['token'],
      namespace: 'system/integrations/linear/workspace',
      projectId: null,
      workspaceId: scope.workspaceId,
    });
    expect(mocks.getSecret.mock.calls.map(([params]) => params)).toContainEqual({
      key: 'token',
      namespace: 'system/integrations/jira/workspace',
      projectId: null,
      workspaceId: scope.workspaceId,
    });
    expect(mocks.setSecrets.mock.calls.map(([params]) => params)).toContainEqual({
      values: {token: 'secret'},
      namespace: 'system/integrations/jira/workspace',
      projectId: null,
      workspaceId: scope.workspaceId,
    });
    expect(mocks.deleteSecrets.mock.calls.map(([params]) => params)).toContainEqual({
      keys: ['token'],
      namespace: 'system/integrations/jira/workspace',
      projectId: null,
      workspaceId: scope.workspaceId,
    });
    expect(mocks.getSecret.mock.calls.map(([params]) => params)).toContainEqual({
      key: 'token',
      namespace: 'system/integrations/slack/workspace',
      projectId: null,
      workspaceId: scope.workspaceId,
    });
    expect(mocks.setSecrets.mock.calls.map(([params]) => params)).toContainEqual({
      values: {token: 'secret'},
      namespace: 'system/integrations/slack/workspace',
      projectId: null,
      workspaceId: scope.workspaceId,
    });
    expect(mocks.deleteSecrets.mock.calls.map(([params]) => params)).toContainEqual({
      keys: ['token'],
      namespace: 'system/integrations/slack/workspace',
      projectId: null,
      workspaceId: scope.workspaceId,
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
