import type {TriggerDecisionOutcomeDto} from '@shipfox/api-triggers-dto';
import type {BadgeVariant} from '@shipfox/react-ui';

export interface TriggerDecisionVisual {
  badge: BadgeVariant;
  label: string;
}

const VISUALS: Record<TriggerDecisionOutcomeDto, TriggerDecisionVisual> = {
  triggered: {badge: 'success', label: 'Triggered'},
  errored: {badge: 'error', label: 'Errored'},
};

const UNKNOWN_VISUAL: TriggerDecisionVisual = {badge: 'warning', label: 'Unknown'};

export function getTriggerDecisionVisual(
  decision: TriggerDecisionOutcomeDto | string,
): TriggerDecisionVisual {
  return VISUALS[decision as TriggerDecisionOutcomeDto] ?? UNKNOWN_VISUAL;
}
