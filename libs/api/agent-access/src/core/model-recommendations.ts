import type {ModelChoiceDto, ModelRecommendationGroupDto} from '@shipfox/api-agent-access-dto';
import type {AgentThinking, Harness} from '@shipfox/api-agent-dto';
import {
  type AgentInterModuleClient,
  type AgentWorkspaceModel,
  agentInterModuleContract,
} from '@shipfox/api-agent-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {
  type ModelRecommendation,
  recommendModels,
  type WorkflowModelAnchor,
  type WorkflowModelAnchors,
  type WorkflowTemplateModel,
} from '@shipfox/workflow-templates';
import type {AgentAccessWorkspaceModels} from './workspace-models.js';

export const MODEL_RECOMMENDATION_COST_NOTE =
  'Cost per task is measured on a benchmark workload. It is not an estimate of what this workflow will cost.';

/** A complete model binding and whether the step must name its provider to get it. */
export interface ModelBinding {
  readonly provider: string;
  readonly harness: Harness;
  readonly model: string;
  readonly thinking: AgentThinking;
  readonly providerRequired: boolean;
  readonly workspaceModel: AgentWorkspaceModel;
}

export type ModelBindingResolver = (
  choice: WorkflowModelAnchor,
) => Promise<ModelBinding | undefined>;

/**
 * Resolves a model and thinking setting to the binding a step gets, in order:
 * the step as written, then the managed provider, then the only other provider
 * that lists it. Several providers without the managed one make it unavailable.
 */
export function createModelBindingResolver(params: {
  agent: AgentInterModuleClient;
  workspaceId: string;
  workspaceModels: AgentAccessWorkspaceModels;
}): ModelBindingResolver {
  const bindings = new Map<string, Promise<ModelBinding | undefined>>();

  return (choice) => {
    const key = `${choice.model}\u0000${choice.thinking}`;
    let binding = bindings.get(key);
    if (binding === undefined) {
      binding = resolveModelBinding({...params, choice});
      bindings.set(key, binding);
    }
    return binding;
  };
}

async function resolveModelBinding(params: {
  agent: AgentInterModuleClient;
  workspaceId: string;
  workspaceModels: AgentAccessWorkspaceModels;
  choice: WorkflowModelAnchor;
}): Promise<ModelBinding | undefined> {
  const {choice, workspaceModels} = params;
  const listing = workspaceModels.models.filter(
    (model) => model.id === choice.model && model.supported_thinking.includes(choice.thinking),
  );
  if (listing.length === 0) return undefined;

  const asWritten = await resolveAsWritten(params);
  if (asWritten !== undefined) {
    const workspaceModel = listing.find(({provider}) => provider === asWritten.provider);
    if (workspaceModel !== undefined && asWritten.thinking === choice.thinking) {
      return {...asWritten, providerRequired: false, workspaceModel};
    }
  }

  const managed = listing.find(({provider}) => provider === workspaceModels.managed_provider_id);
  const others = listing.filter(({provider}) => provider !== workspaceModels.managed_provider_id);
  const workspaceModel = managed ?? (others.length === 1 ? others[0] : undefined);
  if (workspaceModel === undefined) return undefined;

  return {
    provider: workspaceModel.provider,
    harness: workspaceModel.harness,
    model: choice.model,
    thinking: choice.thinking,
    providerRequired: true,
    workspaceModel,
  };
}

async function resolveAsWritten(params: {
  agent: AgentInterModuleClient;
  workspaceId: string;
  choice: WorkflowModelAnchor;
}) {
  try {
    return await params.agent.resolveAgentConfig({
      workspaceId: params.workspaceId,
      config: {model: params.choice.model, thinking: params.choice.thinking},
    });
  } catch (error) {
    if (isInterModuleKnownError(agentInterModuleContract.methods.resolveAgentConfig, error)) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Groups model placeholders by the binding their tested model resolves to and
 * returns the choices for each group. Placeholders keep manifest order.
 */
export async function buildModelRecommendations(params: {
  placeholders: Readonly<Record<string, WorkflowTemplateModel>>;
  anchors: WorkflowModelAnchors;
  workspaceModels: AgentAccessWorkspaceModels;
  resolveBinding: ModelBindingResolver;
}): Promise<ModelRecommendationGroupDto[]> {
  const groups = new Map<string, {placeholders: string[]; notes: Record<string, string>}>();
  const bindings = new Map<string, ModelBinding | undefined>();

  for (const [placeholder, {note}] of Object.entries(params.placeholders)) {
    const anchor = params.anchors[placeholder];
    if (anchor === undefined) throw new Error(`Missing model anchor for ${placeholder}`);
    const binding = await params.resolveBinding(anchor);
    const key =
      binding === undefined
        ? `unavailable\u0000${anchor.model}\u0000${anchor.thinking}`
        : `${binding.provider}\u0000${binding.harness}\u0000${binding.model}\u0000${binding.thinking}`;
    bindings.set(key, binding);

    const group = groups.get(key) ?? {placeholders: [], notes: {}};
    group.placeholders.push(placeholder);
    if (note !== undefined) group.notes[placeholder] = note;
    groups.set(key, group);
  }

  return await Promise.all(
    [...groups].map(async ([key, {placeholders, notes}]) => ({
      placeholders,
      notes,
      ...(await groupChoices({...params, binding: bindings.get(key)})),
    })),
  );
}

type GroupChoices = ModelRecommendationGroupDto extends infer Group
  ? Group extends unknown
    ? Omit<Group, 'placeholders' | 'notes'>
    : never
  : never;

async function groupChoices(params: {
  binding: ModelBinding | undefined;
  workspaceModels: AgentAccessWorkspaceModels;
  resolveBinding: ModelBindingResolver;
}): Promise<GroupChoices> {
  const {binding, workspaceModels} = params;
  if (binding === undefined) return workspaceDefaultChoices(workspaceModels);

  const reference = binding.workspaceModel.references.find(
    ({thinking}) => thinking === binding.thinking,
  );
  const attribution = workspaceModels.attribution;
  if (reference === undefined || attribution === null) {
    return {mode: 'template_default', choices: [unscoredChoice(binding, workspaceModels, true)]};
  }

  const alternatives = recommendModels({
    anchor: {
      model: binding.model,
      thinking: binding.thinking,
      lab: binding.workspaceModel.lab,
      intelligence_index: reference.intelligence_index,
      cost_per_task_usd: reference.cost_per_task_usd,
      scale: reference.scale,
    },
    models: workspaceModels.models,
  });
  const alternativeChoices = await Promise.all(
    alternatives.map(async (alternative) => {
      const alternativeBinding = await params.resolveBinding(alternative);
      return alternativeBinding === undefined
        ? []
        : [scoredChoice(alternativeBinding, workspaceModels, alternative)];
    }),
  );

  return {
    mode: 'recommended',
    choices: [
      {
        ...unscoredChoice(binding, workspaceModels, true),
        intelligence_index: reference.intelligence_index,
        cost_per_task_usd: reference.cost_per_task_usd,
      },
      ...alternativeChoices.flat(),
    ],
    scale: reference.scale,
    attribution,
    cost_note: MODEL_RECOMMENDATION_COST_NOTE,
  };
}

/**
 * The workspace default is what a step resolves to without settings, and
 * provider resolution does not depend on the model, so writing its model and
 * thinking keeps the same provider.
 */
function workspaceDefaultChoices(workspaceModels: AgentAccessWorkspaceModels): GroupChoices {
  const defaultModel = workspaceModels.default_model;
  if (defaultModel === null) return {mode: 'choose', choices: []};

  const binding: ModelBinding = {
    provider: defaultModel.provider,
    harness: defaultModel.harness,
    model: defaultModel.id,
    thinking: defaultModel.thinking,
    providerRequired: false,
    workspaceModel: defaultModel,
  };
  return {mode: 'workspace_default', choices: [unscoredChoice(binding, workspaceModels, false)]};
}

function unscoredChoice(
  binding: ModelBinding,
  workspaceModels: AgentAccessWorkspaceModels,
  isAnchor: boolean,
): ModelChoiceDto & {intelligence_index: null; cost_per_task_usd: null; tradeoff: null} {
  const defaultModel = workspaceModels.default_model;
  return {
    model: binding.model,
    label: binding.workspaceModel.label,
    lab: binding.workspaceModel.lab,
    provider: binding.provider,
    harness: binding.harness,
    thinking: binding.thinking,
    provider_required: binding.providerRequired,
    is_anchor: isAnchor,
    is_default:
      defaultModel !== null &&
      defaultModel.id === binding.model &&
      defaultModel.provider === binding.provider &&
      defaultModel.thinking === binding.thinking,
    intelligence_index: null,
    cost_per_task_usd: null,
    tradeoff: null,
  };
}

function scoredChoice(
  binding: ModelBinding,
  workspaceModels: AgentAccessWorkspaceModels,
  recommendation: ModelRecommendation,
): ModelChoiceDto {
  return {
    ...unscoredChoice(binding, workspaceModels, false),
    // The same model under a provider without lab metadata keeps the scored entry's lab.
    lab: binding.workspaceModel.lab ?? recommendation.lab,
    intelligence_index: recommendation.intelligence_index,
    cost_per_task_usd: recommendation.cost_per_task_usd,
    tradeoff: recommendation.tradeoff,
  };
}
