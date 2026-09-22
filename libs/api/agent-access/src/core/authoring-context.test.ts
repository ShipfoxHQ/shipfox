import {
  getWorkflowAuthoringContextInputJsonSchema,
  getWorkflowAuthoringContextResultSchema,
} from '@shipfox/api-agent-access-dto';
import type {
  AgentInterModuleClient,
  AgentWorkspaceModel,
} from '@shipfox/api-agent-dto/inter-module';
import type {AgentAccessContext} from '@shipfox/api-auth-context';
import type {SecretsInterModuleClient} from '@shipfox/api-secrets-dto/inter-module';
import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import {
  AGENT_ACCESS_AUTHORING_CONTEXT_TOOL_NAME,
  createAgentAccessAuthoringContextTools,
} from './authoring-context.js';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const projectId = '00000000-0000-4000-8000-000000000002';
const context: AgentAccessContext = {
  userId: '00000000-0000-4000-8000-000000000003',
  workspaceId,
  credential: {
    kind: 'oauth_grant',
    grantId: '00000000-0000-4000-8000-000000000004',
    clientId: 'test',
  },
};

describe('get_workflow_authoring_context', () => {
  test('returns models, runners, and names without secret values', async () => {
    const clients = createClients({
      models: {
        models: [workspaceModel({id: 'claude-opus', provider: 'anthropic', is_default: true})],
        default_model: workspaceModel({
          id: 'claude-opus',
          provider: 'anthropic',
          is_default: true,
        }),
        attribution: null,
      },
      runners: ['default'],
      secretNames: ['LINEAR_API_KEY'],
      variableNames: ['LINEAR_TEAM'],
    });

    const response = await tool(clients).execute({context, arguments: {}});

    expect(response).toEqual({
      ok: true,
      result: {
        models: [workspaceModel({id: 'claude-opus', provider: 'anthropic', is_default: true})],
        default_model: workspaceModel({
          id: 'claude-opus',
          provider: 'anthropic',
          is_default: true,
        }),
        attribution: null,
        model_provider_configured: true,
        runners: ['default'],
        secret_names: ['LINEAR_API_KEY'],
        variable_names: ['LINEAR_TEAM'],
      },
    });
    if (!response.ok) throw new Error('Expected a successful response');
    expect(getWorkflowAuthoringContextResultSchema.safeParse(response.result).success).toBe(true);
    expect(JSON.stringify(response)).not.toContain('secret-value');
  });

  test('scopes secret and variable names to the requested project', async () => {
    const clients = createClients();

    await tool(clients).execute({context, arguments: {project_id: projectId}});

    expect(clients.secrets.listSecretNames).toHaveBeenCalledWith({workspaceId, projectId});
    expect(clients.secrets.listVariableNames).toHaveBeenCalledWith({workspaceId, projectId});
  });

  test('succeeds with an unconfigured model provider', async () => {
    const clients = createClients({
      models: {models: [], default_model: null, attribution: null},
    });

    const response = await tool(clients).execute({context, arguments: {}});

    expect(response).toEqual(
      expect.objectContaining({
        ok: true,
        result: expect.objectContaining({
          models: [],
          default_model: null,
          attribution: null,
          model_provider_configured: false,
        }),
      }),
    );
  });

  test('accepts only the optional project_id input', () => {
    expect(getWorkflowAuthoringContextInputJsonSchema).toMatchObject({
      additionalProperties: false,
    });
    expect(tool(createClients()).validateInput?.({})).toBe(true);
    expect(tool(createClients()).validateInput?.({project_id: projectId})).toBe(true);
    expect(tool(createClients()).validateInput?.({unexpected: true})).toBe(false);
  });
});

function tool(clients: ReturnType<typeof createClients>) {
  const candidate = createAgentAccessAuthoringContextTools(clients).find(
    ({name}) => name === AGENT_ACCESS_AUTHORING_CONTEXT_TOOL_NAME,
  );
  if (candidate === undefined) throw new Error('Authoring-context tool was not created');
  return candidate;
}

function createClients(overrides: Partial<AuthoringContextFixtures> = {}) {
  const fixtures = {
    models: {
      models: [workspaceModel({id: 'gpt-5', provider: 'openai', is_default: true})],
      default_model: workspaceModel({id: 'gpt-5', provider: 'openai', is_default: true}),
      attribution: null,
    },
    runners: ['linux'],
    secretNames: ['API_TOKEN'],
    variableNames: ['API_URL'],
    ...overrides,
  };
  const agent = {
    getWorkspaceModels: vi.fn().mockResolvedValue(fixtures.models),
  } as unknown as AgentInterModuleClient;
  const workflows = {
    listRunnerCatalogNames: vi.fn().mockResolvedValue({names: fixtures.runners}),
  } as unknown as WorkflowsModuleClient;
  const secrets = {
    listSecretNames: vi.fn().mockResolvedValue({names: fixtures.secretNames}),
    listVariableNames: vi.fn().mockResolvedValue({names: fixtures.variableNames}),
  } as unknown as SecretsInterModuleClient;

  return {agent, workflows, secrets};
}

function workspaceModel(
  overrides: Partial<AgentWorkspaceModel> & Pick<AgentWorkspaceModel, 'id' | 'provider'>,
): AgentWorkspaceModel {
  return {
    harness: 'pi',
    thinking: 'medium',
    is_default: false,
    price: null,
    reference: null,
    ...overrides,
  };
}

type AuthoringContextFixtures = {
  models: {
    models: readonly AgentWorkspaceModel[];
    default_model: AgentWorkspaceModel | null;
    attribution: string | null;
  };
  runners: readonly string[];
  secretNames: readonly string[];
  variableNames: readonly string[];
};
