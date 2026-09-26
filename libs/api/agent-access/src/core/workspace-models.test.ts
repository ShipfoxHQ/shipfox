import {listWorkspaceModelsResultSchema} from '@shipfox/api-agent-access-dto';
import type {
  AgentInterModuleClient,
  AgentWorkspaceModel,
} from '@shipfox/api-agent-dto/inter-module';
import type {AgentAccessContext} from '@shipfox/api-auth-context';
import {
  AGENT_ACCESS_WORKSPACE_MODELS_TOOL_NAME,
  createAgentAccessWorkspaceModelTools,
  getWorkspaceModels,
} from './workspace-models.js';

const workspaceId = '00000000-0000-4000-8000-000000000001';

describe('getWorkspaceModels', () => {
  test('returns the Agent-owned workspace model result', async () => {
    const model: AgentWorkspaceModel = {
      id: 'claude-opus',
      label: 'Claude Opus',
      lab: 'Anthropic',
      provider: 'anthropic',
      harness: 'claude',
      thinking: 'high',
      supported_thinking: ['low', 'medium', 'high', 'xhigh', 'max'],
      is_default: true,
      price: null,
      references: [],
    };
    const result = {
      models: [model],
      default_model: model,
      attribution: null,
    };
    const getAgentWorkspaceModels = vi.fn().mockResolvedValue(result);
    const agent = {
      getWorkspaceModels: getAgentWorkspaceModels,
    } as unknown as AgentInterModuleClient;

    await expect(getWorkspaceModels(agent, workspaceId)).resolves.toEqual(result);
    expect(getAgentWorkspaceModels).toHaveBeenCalledWith({workspaceId});
  });
});

describe('list_workspace_models', () => {
  test('filters by provider', async () => {
    const response = await tool([
      workspaceModel({id: 'gpt-5', provider: 'openai'}),
      workspaceModel({id: 'claude-sonnet', provider: 'anthropic'}),
    ]).execute({context, arguments: {provider: 'openai'}});

    expect(success(response).models.map(({id}) => id)).toEqual(['gpt-5']);
  });

  test('filters by lab', async () => {
    const response = await tool([
      workspaceModel({id: 'gpt-5', provider: 'openai', lab: 'OpenAI'}),
      workspaceModel({id: 'gpt-5-mini', provider: 'openai', lab: 'Other Lab'}),
    ]).execute({context, arguments: {lab: 'OpenAI'}});

    expect(success(response).models.map(({id}) => id)).toEqual(['gpt-5']);
  });

  test('filters by a case-insensitive substring of id or label', async () => {
    const candidate = tool([
      workspaceModel({id: 'claude-opus', provider: 'anthropic', label: 'Claude Opus'}),
      workspaceModel({id: 'gpt-5', provider: 'openai', label: 'Readable Five'}),
      workspaceModel({id: 'other', provider: 'openai', label: 'Other'}),
    ]);
    const idResponse = await candidate.execute({context, arguments: {query: 'OPUS'}});
    const labelResponse = await candidate.execute({context, arguments: {query: 'FIVE'}});

    expect(success(idResponse).models.map(({id}) => id)).toEqual(['claude-opus']);
    expect(success(labelResponse).models.map(({id}) => id)).toEqual(['gpt-5']);
  });

  test('filters to scored models', async () => {
    const response = await tool([
      workspaceModel({id: 'scored', provider: 'openai', references: [reference()]}),
      workspaceModel({id: 'unscored', provider: 'openai'}),
    ]).execute({context, arguments: {scored_only: true}});

    expect(success(response).models.map(({id}) => id)).toEqual(['scored']);
  });

  test('continues after byte trimming without skipping or repeating models', async () => {
    const models = Array.from({length: 100}, (_, index) =>
      workspaceModel({
        id: `model-${index}`,
        provider: 'openai',
        label: `Model ${index} ${'x'.repeat(2_000)}`,
      }),
    );
    const candidate = tool(models);
    const ids: string[] = [];
    let cursor: string | undefined;
    let firstResponse: Awaited<ReturnType<typeof candidate.execute>> | undefined;

    for (let page = 0; page < 10; page += 1) {
      const response = await candidate.execute({
        context,
        arguments: cursor === undefined ? {limit: 100} : {limit: 100, cursor},
      });
      firstResponse ??= response;
      const result = success(response);
      ids.push(...result.models.map(({id}) => id));
      cursor = result.next_cursor ?? undefined;
      if (cursor === undefined) break;
    }

    expect(firstResponse).toMatchObject({ok: true, response_truncated: true});
    expect(ids).toHaveLength(models.length);
    expect(new Set(ids).size).toBe(models.length);
    expect(ids).toEqual(models.map(({id}) => id));
  });

  test('rejects a cursor that does not identify the filtered catalog', async () => {
    const response = await tool([workspaceModel({id: 'gpt-5', provider: 'openai'})]).execute({
      context,
      arguments: {cursor: 'not-a-cursor'},
    });

    expect(response).toEqual({ok: false, error: {code: 'invalid-request'}});
  });
});

const context: AgentAccessContext = {
  userId: '00000000-0000-4000-8000-000000000003',
  workspaceId,
  credential: {
    kind: 'oauth_grant',
    grantId: '00000000-0000-4000-8000-000000000004',
    clientId: 'test',
  },
};

function tool(models: readonly AgentWorkspaceModel[]) {
  const agent = {
    getWorkspaceModels: vi.fn().mockResolvedValue({models, default_model: null, attribution: null}),
  } as unknown as AgentInterModuleClient;
  const candidate = createAgentAccessWorkspaceModelTools(agent).find(
    ({name}) => name === AGENT_ACCESS_WORKSPACE_MODELS_TOOL_NAME,
  );
  if (candidate === undefined) throw new Error('Workspace-model tool was not created');
  return candidate;
}

function success(response: Awaited<ReturnType<ReturnType<typeof tool>['execute']>>) {
  if (!response.ok) throw new Error(`Expected success: ${JSON.stringify(response)}`);
  return listWorkspaceModelsResultSchema.parse(response.result);
}

function reference() {
  return {
    thinking: 'high' as const,
    intelligence_index: 70,
    cost_per_task_usd: 0.1,
    scale: 'aa-v1',
  };
}

function workspaceModel(
  overrides: Partial<AgentWorkspaceModel> & Pick<AgentWorkspaceModel, 'id' | 'provider'>,
): AgentWorkspaceModel {
  return {
    label: null,
    lab: null,
    harness: 'pi',
    thinking: 'medium',
    supported_thinking: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
    is_default: false,
    price: null,
    references: [],
    ...overrides,
  };
}
