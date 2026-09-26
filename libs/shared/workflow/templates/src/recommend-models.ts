import type {AgentThinking} from '@shipfox/workflow-document';

export const RECOMMENDATION_INDEX_BAND = 10;
export const SIMILAR_INTELLIGENCE_BAND = 3;
export const MUCH_CHEAPER_RATIO = 1 / 3;
export const CHEAPER_RATIO = 0.8;
export const MORE_EXPENSIVE_RATIO = 1.25;
export const MUCH_MORE_EXPENSIVE_RATIO = 3;

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

export interface RecommendationReference {
  thinking: AgentThinking;
  intelligence_index: number;
  cost_per_task_usd: number;
  scale: string;
}

export interface RecommendationAnchor {
  model: string;
  thinking: AgentThinking;
  lab: string | null;
  intelligence_index: number;
  cost_per_task_usd: number;
  scale: string;
}

export interface RecommendationModel {
  id: string;
  lab: string | null;
  references: readonly RecommendationReference[];
}

export interface RecommendModelsInput {
  anchor: RecommendationAnchor;
  models: readonly RecommendationModel[];
}

export type IntelligenceTradeoff = 'slightly_smarter' | 'similar' | 'slightly_less_capable';
export type CostTradeoff =
  | 'much_cheaper'
  | 'cheaper'
  | 'similar'
  | 'more_expensive'
  | 'much_more_expensive';

export interface ModelTradeoff {
  intelligence: IntelligenceTradeoff;
  cost: CostTradeoff;
  label: string;
}

export interface ModelRecommendation {
  model: string;
  lab: string;
  thinking: AgentThinking;
  intelligence_index: number;
  cost_per_task_usd: number;
  tradeoff: ModelTradeoff;
}

interface Candidate extends ModelRecommendation {
  readonly delta: number;
  readonly catalogIndex: number;
}

/**
 * Selects up to four scored alternatives to an anchor.
 *
 * Candidates are selected from the anchor's scale and ten-point index band. The
 * cheaper and smarter slots are chosen before lab-diversity fill slots, and a
 * model selected for one slot removes all of its thinking levels from later
 * slots. The returned alternatives are ordered by intelligence index, highest
 * first.
 */
export function recommendModels({anchor, models}: RecommendModelsInput): ModelRecommendation[] {
  const pool = scoredCandidates(anchor, models);
  const selected: Candidate[] = [];
  const representedLabs = new Set<string>();
  if (anchor.lab !== null) representedLabs.add(anchor.lab);

  selectCandidate(
    pool,
    selected,
    representedLabs,
    (candidate) => candidate.cost_per_task_usd < anchor.cost_per_task_usd && candidate.delta >= -3,
    compareByCost,
  );
  selectCandidate(
    pool,
    selected,
    representedLabs,
    (candidate) => candidate.delta > SIMILAR_INTELLIGENCE_BAND,
    compareByCost,
  );

  while (selected.length < 4 && pool.length > 0) {
    const unrepresented = pool.filter((candidate) => !representedLabs.has(candidate.lab));
    const candidates = unrepresented.length > 0 ? unrepresented : pool;
    const candidate = [...candidates].sort(compareByCloseness)[0];
    if (candidate === undefined) break;
    takeCandidate(candidate, pool, selected, representedLabs);
  }

  return selected
    .sort(
      (left, right) =>
        right.intelligence_index - left.intelligence_index ||
        compareByCost(left, right) ||
        left.catalogIndex - right.catalogIndex ||
        thinkingIndex(left.thinking) - thinkingIndex(right.thinking),
    )
    .map(({delta: _delta, catalogIndex: _catalogIndex, ...recommendation}) => recommendation);
}

function scoredCandidates(
  anchor: RecommendationAnchor,
  models: readonly RecommendationModel[],
): Candidate[] {
  return models.flatMap((model, catalogIndex) => {
    const lab = model.lab;
    if (lab === null || model.id === anchor.model) return [];

    return model.references.flatMap((reference) => {
      if (reference.scale !== anchor.scale) return [];
      const delta = reference.intelligence_index - anchor.intelligence_index;
      if (Math.abs(delta) > RECOMMENDATION_INDEX_BAND) return [];

      return [
        {
          model: model.id,
          lab,
          thinking: reference.thinking,
          intelligence_index: reference.intelligence_index,
          cost_per_task_usd: reference.cost_per_task_usd,
          tradeoff: tradeoff(anchor, reference, delta),
          delta,
          catalogIndex,
        },
      ];
    });
  });
}

function selectCandidate(
  pool: Candidate[],
  selected: Candidate[],
  representedLabs: Set<string>,
  eligible: (candidate: Candidate) => boolean,
  compare: (left: Candidate, right: Candidate) => number,
): void {
  const candidate = [...pool].filter(eligible).sort(compare)[0];
  if (candidate !== undefined) takeCandidate(candidate, pool, selected, representedLabs);
}

function takeCandidate(
  candidate: Candidate,
  pool: Candidate[],
  selected: Candidate[],
  representedLabs: Set<string>,
): void {
  selected.push(candidate);
  representedLabs.add(candidate.lab);
  for (let index = pool.length - 1; index >= 0; index -= 1) {
    if (pool[index]?.model === candidate.model) pool.splice(index, 1);
  }
}

function compareByCost(left: Candidate, right: Candidate): number {
  return (
    left.cost_per_task_usd - right.cost_per_task_usd ||
    right.intelligence_index - left.intelligence_index ||
    left.catalogIndex - right.catalogIndex ||
    thinkingIndex(left.thinking) - thinkingIndex(right.thinking)
  );
}

function compareByCloseness(left: Candidate, right: Candidate): number {
  return Math.abs(left.delta) - Math.abs(right.delta) || compareByCost(left, right);
}

function thinkingIndex(thinking: AgentThinking): number {
  return thinkingOrder.indexOf(thinking);
}

function tradeoff(
  anchor: RecommendationAnchor,
  reference: RecommendationReference,
  delta: number,
): ModelTradeoff {
  const intelligence = intelligenceTradeoff(delta);
  const cost = costTradeoff(anchor.cost_per_task_usd, reference.cost_per_task_usd);
  return {
    intelligence,
    cost,
    label: `${capitalize(intelligenceLabel(intelligence))}, ${costLabel(cost)}`,
  };
}

function intelligenceTradeoff(delta: number): IntelligenceTradeoff {
  if (delta > SIMILAR_INTELLIGENCE_BAND) return 'slightly_smarter';
  if (delta >= -SIMILAR_INTELLIGENCE_BAND) return 'similar';
  return 'slightly_less_capable';
}

function intelligenceLabel(tradeoff: IntelligenceTradeoff): string {
  switch (tradeoff) {
    case 'slightly_smarter':
      return 'slightly smarter';
    case 'similar':
      return 'similar intelligence';
    case 'slightly_less_capable':
      return 'slightly less capable';
  }
}

function costTradeoff(anchorCost: number, candidateCost: number): CostTradeoff {
  if (anchorCost === 0) return candidateCost === 0 ? 'similar' : 'much_more_expensive';

  const ratio = candidateCost / anchorCost;
  if (ratio < MUCH_CHEAPER_RATIO) return 'much_cheaper';
  if (ratio < CHEAPER_RATIO) return 'cheaper';
  if (ratio <= MORE_EXPENSIVE_RATIO) return 'similar';
  if (ratio <= MUCH_MORE_EXPENSIVE_RATIO) return 'more_expensive';
  return 'much_more_expensive';
}

function costLabel(tradeoff: CostTradeoff): string {
  switch (tradeoff) {
    case 'much_cheaper':
      return 'much cheaper';
    case 'cheaper':
      return 'cheaper';
    case 'similar':
      return 'similar cost';
    case 'more_expensive':
      return 'more expensive';
    case 'much_more_expensive':
      return 'much more expensive';
  }
}

function capitalize(value: string): string {
  return value[0]?.toUpperCase() + value.slice(1);
}
