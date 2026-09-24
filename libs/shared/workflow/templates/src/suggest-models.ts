import type {AgentThinking, Harness} from '@shipfox/workflow-document';
import type {WorkflowTemplateModel} from './manifest.js';

export interface SuggestionModel {
  id: string;
  provider: string;
  harness: Harness;
  thinking: AgentThinking;
  supported_thinking: readonly AgentThinking[];
  price: {input: number; output: number} | null;
  references: readonly {
    thinking: AgentThinking;
    intelligence_index: number;
    cost_per_task_usd: number;
    scale: string;
  }[];
}

export interface SuggestionWorkspaceModels {
  models: readonly SuggestionModel[];
  default_model: SuggestionModel | null;
  attribution: string | null;
}

type ModelChoice = Pick<SuggestionModel, 'id' | 'provider' | 'harness' | 'price'> & {
  thinking: AgentThinking;
  is_default: boolean;
  reference: SuggestionModel['references'][number] | null;
  below_reference?: true;
};

export interface ModelSuggestion {
  reference: {model: string; thinking: AgentThinking; intelligence_index: number} | null;
  note: string | null;
  outcome: 'suggested' | 'list';
  models: ModelChoice[];
  attribution: string | null;
}

const thinkingOrder: readonly AgentThinking[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'default',
];

/** Suggests the cheapest scored setting at or above the tested index, or lists all choices when scores cannot be compared. */
export function suggestModels(
  placeholder: WorkflowTemplateModel,
  workspace: SuggestionWorkspaceModels,
): ModelSuggestion {
  const choices = workspace.models.flatMap((model) =>
    [...model.supported_thinking]
      .sort((left, right) => thinkingOrder.indexOf(left) - thinkingOrder.indexOf(right))
      .map(
        (thinking): ModelChoice => ({
          id: model.id,
          provider: model.provider,
          harness: model.harness,
          thinking,
          is_default:
            model.id === workspace.default_model?.id &&
            model.provider === workspace.default_model.provider &&
            thinking === workspace.default_model.thinking,
          price: model.price,
          reference: model.references.find((reference) => reference.thinking === thinking) ?? null,
        }),
      ),
  );
  const scored = choices.filter((choice) => choice.reference !== null);
  const tested = placeholder.reference;
  const referenceChoices = choices.filter(
    (choice) => choice.id === tested?.model && choice.thinking === tested.thinking,
  );
  const referenceChoice = referenceChoices.length === 1 ? referenceChoices[0] : undefined;
  const reference = referenceChoice?.reference;
  const referenceSummary =
    referenceChoice !== undefined && reference !== null && reference !== undefined
      ? {
          model: referenceChoice.id,
          thinking: referenceChoice.thinking,
          intelligence_index: reference.intelligence_index,
        }
      : null;
  const scales = new Set(scored.map((choice) => choice.reference?.scale));
  const base = {note: placeholder.note ?? null, attribution: workspace.attribution};

  if (referenceSummary === null || scales.size !== 1) {
    return {reference: referenceSummary, outcome: 'list', models: choices, ...base};
  }

  const byCost = (left: ModelChoice, right: ModelChoice) =>
    // Stable sorting preserves catalog order, then canonical thinking order, on ties.
    (left.reference?.cost_per_task_usd ?? 0) - (right.reference?.cost_per_task_usd ?? 0);
  const qualifying = scored
    .filter(
      (choice) =>
        (choice.reference?.intelligence_index ?? -Infinity) >= referenceSummary.intelligence_index,
    )
    .sort(byCost);
  const below = scored
    .filter(
      (choice) =>
        (choice.reference?.intelligence_index ?? -Infinity) < referenceSummary.intelligence_index,
    )
    .sort(byCost)
    .map((choice) => ({...choice, below_reference: true as const}));
  const unscored = choices.filter((choice) => choice.reference === null);

  return {
    reference: referenceSummary,
    outcome: 'suggested',
    models: [...qualifying, ...below, ...unscored],
    ...base,
  };
}
