import type {ModelChoiceDto} from '@shipfox/api-agent-access-dto';
import {
  type AgentInterModuleClient,
  type AgentWorkspaceModel,
  agentInterModuleContract,
} from '@shipfox/api-agent-dto/inter-module';
import {createInterModuleKnownError, defineInterModulePresentation} from '@shipfox/inter-module';
import {createFakeInterModuleClients} from '@shipfox/node-module/inter-module/testing';

const ALL_THINKING = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
const MODEL_MARKER_RE = /^(\s*)model:\s*\S+\s+#\s*model:([a-z0-9_-]+)\s*$/u;
const FIELD_RE = /^(\s*)(model|thinking|provider|harness):\s*(\S+)/u;
const LEADING_SPACES_RE = /^\s*/u;

export const TEST_ATTRIBUTION = 'Benchmark source';

export function workspaceModel(
  overrides: Partial<AgentWorkspaceModel> & Pick<AgentWorkspaceModel, 'id' | 'provider'>,
): AgentWorkspaceModel {
  return {
    label: null,
    lab: null,
    harness: 'pi',
    thinking: 'medium',
    supported_thinking: [...ALL_THINKING],
    is_default: false,
    price: null,
    references: [],
    ...overrides,
  };
}

export function scoredModel(params: {
  id: string;
  provider: string;
  lab: string;
  thinking: AgentWorkspaceModel['thinking'];
  index: number;
  cost: number;
  scale?: string;
}): AgentWorkspaceModel {
  return workspaceModel({
    id: params.id,
    provider: params.provider,
    label: params.id.toUpperCase(),
    lab: params.lab,
    references: [
      {
        thinking: params.thinking,
        intelligence_index: params.index,
        cost_per_task_usd: params.cost,
        scale: params.scale ?? 'coding-v1',
      },
    ],
  });
}

/**
 * Agent contract fake whose `resolveAgentConfig` follows runtime resolution: an
 * explicit provider wins, otherwise the step gets `runtimeProvider`, and the
 * model must be listed by the resolved provider.
 */
export function createTestAgentClient(params: {
  models: readonly AgentWorkspaceModel[];
  runtimeProvider: string;
  managedProviderId?: string | null;
  defaultModel?: {id: string; provider: string} | null;
}): AgentInterModuleClient {
  const defaultModel =
    params.defaultModel === null || params.defaultModel === undefined
      ? undefined
      : params.models.find(
          ({id, provider}) =>
            id === params.defaultModel?.id && provider === params.defaultModel.provider,
        );
  const models = params.models.map((model) => ({...model, is_default: model === defaultModel}));

  return createFakeInterModuleClients({
    agent: defineInterModulePresentation(agentInterModuleContract, {
      getValidationCatalog: vi.fn(),
      getValidationCatalogV2: vi.fn(),
      getWorkspaceModels: () =>
        Promise.resolve({
          models,
          default_model: models.find(({is_default: isDefault}) => isDefault) ?? null,
          attribution: models.some(({references}) => references.length > 0)
            ? TEST_ATTRIBUTION
            : null,
          managed_provider_id: params.managedProviderId ?? null,
        }),
      resolveAgentConfig: ({config}) => {
        const provider = config.provider ?? params.runtimeProvider;
        const model = models.find(({id, provider: modelProvider}) => {
          return id === config.model && modelProvider === provider;
        });
        if (model === undefined || config.model === undefined) {
          return Promise.reject(
            createInterModuleKnownError(
              agentInterModuleContract.methods.resolveAgentConfig,
              'agent-config-invalid',
              {},
            ),
          );
        }
        return Promise.resolve({
          harness: config.harness ?? model.harness,
          provider,
          model: config.model,
          thinking: (config.thinking ?? model.thinking) as AgentWorkspaceModel['thinking'],
        });
      },
      resolveRuntimeCredentials: vi.fn(),
      claimSession: vi.fn(),
      releaseSession: vi.fn(),
      carryOverSessions: vi.fn(),
    }),
  }).agent;
}

/** Binds a choice at every `# model:<placeholder>` line, as the template playbook does. */
export function applyModelChoice(
  yaml: string,
  placeholder: string,
  choice: Pick<ModelChoiceDto, 'model' | 'thinking' | 'provider' | 'provider_required'>,
  options: {writeProvider?: boolean | undefined} = {},
): string {
  const lines = yaml.split('\n');
  const output: string[] = [];
  let stepIndentation: string | undefined;

  for (const line of lines) {
    const marker = MODEL_MARKER_RE.exec(line);
    if (marker?.[2] === placeholder) {
      stepIndentation = marker[1] ?? '';
      output.push(`${stepIndentation}model: ${choice.model} # model:${placeholder}`);
      if (choice.provider_required || options.writeProvider === true) {
        output.push(`${stepIndentation}provider: ${choice.provider}`);
      }
      continue;
    }
    if (stepIndentation !== undefined && leavesStep(line, stepIndentation)) {
      stepIndentation = undefined;
    }
    const field = FIELD_RE.exec(line);
    if (
      stepIndentation !== undefined &&
      field?.[1] === stepIndentation &&
      field[2] === 'thinking'
    ) {
      output.push(`${stepIndentation}thinking: ${choice.thinking}`);
      continue;
    }
    output.push(line);
  }

  return output.join('\n');
}

/** Reads the agent fields of each step marked with `# model:<placeholder>`. */
export function markedStepConfigs(
  yaml: string,
  placeholder: string,
): {harness?: 'pi' | 'claude'; provider?: string; model?: string; thinking?: string}[] {
  const configs: Record<string, string>[] = [];
  let current: Record<string, string> | undefined;
  let stepIndentation: string | undefined;

  for (const line of yaml.split('\n')) {
    const marker = MODEL_MARKER_RE.exec(line);
    if (marker?.[2] === placeholder) {
      stepIndentation = marker[1] ?? '';
      current = {};
      configs.push(current);
    }
    if (stepIndentation !== undefined && leavesStep(line, stepIndentation)) {
      current = undefined;
      stepIndentation = undefined;
    }
    const field = FIELD_RE.exec(line);
    if (current !== undefined && field !== null && field[1] === stepIndentation) {
      const [, , key, value] = field;
      if (key !== undefined && value !== undefined) current[key] = value;
    }
  }

  return configs as ReturnType<typeof markedStepConfigs>;
}

function leavesStep(line: string, stepIndentation: string): boolean {
  if (line.trim() === '') return false;
  return (LEADING_SPACES_RE.exec(line)?.[0].length ?? 0) < stepIndentation.length;
}
