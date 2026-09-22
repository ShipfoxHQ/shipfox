import type {
  AgentInterModuleClient,
  AgentWorkspaceModel,
} from '@shipfox/api-agent-dto/inter-module';
import {getWorkspaceModels} from './workspace-models.js';

const workspaceId = '00000000-0000-4000-8000-000000000001';

describe('getWorkspaceModels', () => {
  test('returns the Agent-owned workspace model result', async () => {
    const model: AgentWorkspaceModel = {
      id: 'claude-opus',
      provider: 'anthropic',
      harness: 'claude',
      thinking: 'high',
      is_default: true,
      price: null,
      reference: null,
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
