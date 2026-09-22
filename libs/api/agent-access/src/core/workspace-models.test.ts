import type {
  AgentInterModuleClient,
  AgentValidationCatalogV2,
} from '@shipfox/api-agent-dto/inter-module';
import {getWorkspaceModels} from './workspace-models.js';

const workspaceId = '00000000-0000-4000-8000-000000000001';

describe('getWorkspaceModels', () => {
  test('returns catalog models and the resolved default model', async () => {
    const agent = createAgentClient({
      catalog: createCatalog({
        providers: [{id: 'anthropic', support_status: 'supported'}],
        modelIdsByProvider: {anthropic: ['claude-haiku', 'claude-opus']},
      }),
      resolved: {provider: 'anthropic', model: 'claude-opus'},
    });

    await expect(getWorkspaceModels(agent, workspaceId)).resolves.toEqual({
      models: [
        {id: 'claude-haiku', provider: 'anthropic'},
        {id: 'claude-opus', provider: 'anthropic'},
      ],
      default_model: {id: 'claude-opus', provider: 'anthropic'},
    });
    expect(agent.getValidationCatalogV2).toHaveBeenCalledWith({workspaceId});
    expect(agent.resolveAgentConfig).toHaveBeenCalledWith({workspaceId, config: {}});
  });

  test('returns an empty successful result when no provider is usable', async () => {
    const agent = createAgentClient({
      catalog: createCatalog({
        providers: [{id: 'anthropic', support_status: 'unsupported'}],
        modelIdsByProvider: {anthropic: ['claude-opus']},
      }),
      resolveError: new Error('no usable provider'),
    });

    await expect(getWorkspaceModels(agent, workspaceId)).resolves.toEqual({
      models: [],
      default_model: null,
    });
    expect(agent.resolveAgentConfig).not.toHaveBeenCalled();
  });

  test('does not expose a resolved default whose provider is absent from the catalog', async () => {
    const agent = createAgentClient({
      catalog: createCatalog({
        providers: [{id: 'anthropic', support_status: 'supported'}],
        modelIdsByProvider: {anthropic: ['claude-opus']},
      }),
      resolved: {provider: 'openai', model: 'gpt-5.5-pro'},
    });

    await expect(getWorkspaceModels(agent, workspaceId)).resolves.toEqual({
      models: [{id: 'claude-opus', provider: 'anthropic'}],
      default_model: null,
    });
  });
});

function createCatalog(params: {
  providers: AgentValidationCatalogV2['providers'];
  modelIdsByProvider: Record<string, string[]>;
}): AgentValidationCatalogV2 {
  return {
    version: 2,
    default_harness_id: 'pi',
    providers: params.providers,
    harnesses: [
      {
        id: 'pi',
        supported_provider_ids: params.providers.map(({id}) => id),
        model_ids_by_provider: params.modelIdsByProvider,
        thinking_levels: [],
        effective_tools: [],
      },
    ],
  };
}

function createAgentClient(params: {
  catalog: AgentValidationCatalogV2;
  resolved?: {provider: string; model: string};
  resolveError?: unknown;
}): AgentInterModuleClient {
  return {
    getValidationCatalogV2: vi.fn().mockResolvedValue(params.catalog),
    resolveAgentConfig:
      params.resolveError === undefined
        ? vi.fn().mockResolvedValue({
            harness: 'pi',
            provider: params.resolved?.provider ?? 'anthropic',
            model: params.resolved?.model ?? 'claude-opus',
            thinking: 'xhigh',
          })
        : vi.fn().mockRejectedValue(params.resolveError),
  } as unknown as AgentInterModuleClient;
}
